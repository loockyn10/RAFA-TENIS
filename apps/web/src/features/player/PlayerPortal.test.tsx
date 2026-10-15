import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthProvider'
import { PlayerPortal } from './PlayerPortal'
import type { PlayerClubAccess } from '../../types/domain'

const TZ = 'America/Argentina/Buenos_Aires'
const user = { id: 'auth-user-a', email: 'juan@correo.test' } as User
const clubA: PlayerClubAccess = { club_id: 'club-a', club_name: 'Rafa Tenis', timezone: TZ, person_id: 'person-a', full_name: 'Juan Pérez', membership_status: null }
const clubB: PlayerClubAccess = { club_id: 'club-b', club_name: 'Club Norte', timezone: TZ, person_id: 'person-b', full_name: 'Juan Pérez', membership_status: 'active' }
const settings = (enabled: boolean) => ({ enabled, opens_at: '07:00', closes_at: '23:00', max_advance_days: 7, allowed_durations_minutes: [60, 90], max_active_reservations: 2, cancellation_lead_minutes: 120, configured: true })

function makeClient(handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    const handler = handlers[name]
    if (handler) return Promise.resolve(handler(args))
    if (name === 'get_online_booking_settings') return Promise.resolve({ data: settings(false), error: null })
    if (name === 'player_profile') return Promise.resolve({ data: { full_name: 'Juan Pérez', phone: null, email: null, membership_status: null }, error: null })
    return Promise.resolve({ data: [], error: null })
  })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc,
  } as unknown as SupabaseClient
  return { client, rpc }
}

const renderPortal = (client: SupabaseClient, access = [clubA], onOpenAdmin?: () => void) =>
  render(<AuthProvider client={client}><PlayerPortal access={access} user={user} onOpenAdmin={onOpenAdmin} /></AuthProvider>)

const courts = [{ id: 'court-1', name: 'Cancha 1', display_order: 1, occupied: [] }, { id: 'court-2', name: 'Cancha 2', display_order: 2, occupied: [] }]

const summaryButton = () => screen.getAllByRole('button', { name: /^(Reservar|Reintentar)$/ }).find((button) => button.closest('.p-summary'))!

/** Abre Reservar y elige mañana (siempre con horarios libres) a las `time`. */
async function pickTomorrowSlot(time: string) {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Reservar cancha' }))[0])
  const days = await screen.findAllByRole('option', { name: /\d/ })
  fireEvent.click(days[1])
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(time) }))
}

describe('PlayerPortal', () => {
  beforeAll(() => { window.scrollTo = vi.fn() })

  it('muestra el inicio del jugador y avisa que las reservas online están pausadas cuando el club no las activó', async () => {
    const { client } = makeClient()
    renderPortal(client)

    expect(await screen.findByRole('heading', { name: 'Hola, Juan' })).toBeInTheDocument()
    expect(screen.getByText('Sin membresía')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reservar cancha' })[0])
    expect(await screen.findByText('Las reservas online están pausadas')).toBeInTheDocument()
    expect(summaryButton()).toBeDisabled()
  })

  it('consulta únicamente el club elegido y descarta lo del otro al cambiar de club', async () => {
    const { client, rpc } = makeClient({
      player_profile: (args) => ({ data: { full_name: 'Juan Pérez', phone: null, email: null, membership_status: args.p_club_id === 'club-b' ? 'active' : null }, error: null }),
    })
    renderPortal(client, [clubA, clubB])
    expect(await screen.findByText('Sin membresía')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('player_reservations', { p_club_id: 'club-a' })
    expect(rpc.mock.calls.every(([, args]) => (args as { p_club_id?: string }).p_club_id === 'club-a')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }))
    fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Club'), { target: { value: 'club-b' } })
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('player_reservations', { p_club_id: 'club-b' }))
    expect(await screen.findByText('Membresía activa')).toBeInTheDocument()
    expect(screen.queryByText('Sin membresía')).not.toBeInTheDocument()
  })

  it('reserva con la función real usando la hora del club, la cancha libre y la duración permitida', async () => {
    const { client, rpc } = makeClient({
      get_online_booking_settings: () => ({ data: settings(true), error: null }),
      player_court_availability: () => ({ data: courts, error: null }),
      create_player_reservation: () => ({ data: 'reservation-1', error: null }),
    })
    renderPortal(client)
    await pickTomorrowSlot('09:00')
    fireEvent.click(summaryButton())

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_player_reservation', expect.objectContaining({ p_club_id: 'club-a', p_court_id: 'court-1', p_duration_minutes: 60 })))
    const call = rpc.mock.calls.find(([name]) => name === 'create_player_reservation')!
    // 09:00 en Buenos Aires (UTC−3) = 12:00 UTC.
    expect((call[1] as { p_starts_at: string }).p_starts_at).toMatch(/T12:00:00\.000Z$/)
    expect(await screen.findByText('¡Reserva confirmada!')).toBeInTheDocument()
  })

  it('muestra el aviso del servidor cuando rechaza la reserva y no la da por confirmada', async () => {
    const { client } = makeClient({
      get_online_booking_settings: () => ({ data: settings(true), error: null }),
      player_court_availability: () => ({ data: courts, error: null }),
      create_player_reservation: () => ({ data: null, error: { code: '22023', message: 'Alcanzaste el máximo de reservas futuras permitido.' } }),
    })
    renderPortal(client)
    await pickTomorrowSlot('10:00')
    fireEvent.click(summaryButton())

    expect(await screen.findByText('Alcanzaste el máximo de reservas futuras permitido.')).toBeInTheDocument()
    expect(screen.queryByText('¡Reserva confirmada!')).not.toBeInTheDocument()
  })

  it('ante un conflicto concurrente vuelve a consultar la disponibilidad real', async () => {
    const availability = vi.fn(() => ({ data: courts, error: null }))
    const { client } = makeClient({
      get_online_booking_settings: () => ({ data: settings(true), error: null }),
      player_court_availability: availability,
      create_player_reservation: () => ({ data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }),
    })
    renderPortal(client)
    await pickTomorrowSlot('11:00')
    const before = availability.mock.calls.length
    fireEvent.click(summaryButton())

    expect(await screen.findByText(/Alguien tomó ese horario/)).toBeInTheDocument()
    await waitFor(() => expect(availability.mock.calls.length).toBeGreaterThan(before))
    expect(screen.queryByText(/exclusion constraint/)).not.toBeInTheDocument()
  })

  it('no ofrece reservar cuando el jugador ya alcanzó el máximo de turnos activos', async () => {
    const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
    const { client } = makeClient({
      get_online_booking_settings: () => ({ data: { ...settings(true), max_active_reservations: 1 }, error: null }),
      player_reservations: () => ({ data: [{ id: 'r-1', court_name: 'Cancha 1', starts_at: future(48), ends_at: future(49), status: 'confirmed', can_cancel: true }], error: null }),
      player_court_availability: () => ({ data: courts, error: null }),
    })
    renderPortal(client)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Reservar cancha' }))[0])
    expect(await screen.findByText(/Ya tenés 1 turno activo/)).toBeInTheDocument()
    expect(summaryButton()).toBeDisabled()
  })

  it('cancela solo los turnos que el servidor marca como cancelables y pide confirmación', async () => {
    const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
    const { client, rpc } = makeClient({
      get_online_booking_settings: () => ({ data: settings(true), error: null }),
      player_reservations: () => ({ data: [
        { id: 'r-1', court_name: 'Cancha 1', starts_at: future(48), ends_at: future(49), status: 'confirmed', can_cancel: true },
        { id: 'r-2', court_name: 'Cancha 2', starts_at: future(50), ends_at: future(51), status: 'confirmed', can_cancel: false },
      ], error: null }),
      cancel_player_reservation: () => ({ data: null, error: null }),
    })
    renderPortal(client)
    fireEvent.click((await screen.findAllByRole('button', { name: /Mis turnos/ }))[0])
    expect(await screen.findAllByRole('button', { name: 'Cancelar' })).toHaveLength(1)
    expect(screen.getByText('Sin cancelación')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(rpc).not.toHaveBeenCalledWith('cancel_player_reservation', expect.anything())
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('cancel_player_reservation', { p_reservation_id: 'r-1' }))
  })

  it('muestra las cuotas propias y aclara que se pagan en el club', async () => {
    const { client } = makeClient({
      player_membership_dues: () => ({ data: [{ id: 'd-1', period: '2026-10-01', due_date: '2026-10-10', amount_cents: 2500000, paid_cents: 1000000, balance_cents: 1500000, payments: [{ amount_cents: 1000000, payment_date: '2026-10-05', payment_method: 'cash' }] }], error: null }),
    })
    renderPortal(client)
    fireEvent.click((await screen.findAllByRole('button', { name: /Perfil/ }))[0])
    expect(await screen.findByText('Octubre 2026')).toBeInTheDocument()
    expect(screen.getByText(/resta/)).toBeInTheDocument()
    expect(screen.getByText(/Las cuotas se pagan en el club/)).toBeInTheDocument()
  })

  describe('Mi perfil compacto', () => {
    const profile = { full_name: 'Juan Pérez', phone: '11 5555-1234', email: 'juan@correo.test', membership_status: 'active' }
    const openProfile = async (client: SupabaseClient) => {
      renderPortal(client)
      fireEvent.click((await screen.findAllByRole('button', { name: /Perfil/ }))[0])
      return screen.findByRole('heading', { name: 'Mi perfil' })
    }

    it('muestra una tarjeta de solo lectura con nombre, teléfono y correo, sin formulario, y deja las cuotas a la vista', async () => {
      const { client } = makeClient({ player_profile: () => ({ data: profile, error: null }) })
      await openProfile(client)
      expect(screen.getByRole('heading', { name: 'Juan Pérez' })).toBeInTheDocument()
      expect(screen.getByText('11 5555-1234')).toBeInTheDocument()
      expect(screen.getByText('juan@correo.test')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Editar mis datos' })).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Mis cuotas' })).toBeInTheDocument()
    })

    it('indica «Sin cargar» cuando faltan teléfono o correo', async () => {
      const { client } = makeClient({ player_profile: () => ({ data: { ...profile, phone: null, email: null }, error: null }) })
      await openProfile(client)
      expect(screen.getAllByText('Sin cargar')).toHaveLength(2)
    })

    it('el lápiz abre el formulario existente; guardar usa la RPC de siempre y vuelve a la tarjeta', async () => {
      let current = profile
      const { client, rpc } = makeClient({
        player_profile: () => ({ data: current, error: null }),
        update_player_profile: (args) => { current = { ...current, full_name: String(args.p_full_name), phone: String(args.p_phone), email: String(args.p_email) }; return { data: null, error: null } },
      })
      await openProfile(client)
      fireEvent.click(screen.getByRole('button', { name: 'Editar mis datos' }))
      const save = screen.getByRole('button', { name: 'Guardar cambios' })
      expect(save).toBeDisabled()
      fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '11 4444-0000' } })
      fireEvent.click(save)
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('update_player_profile', { p_club_id: 'club-a', p_full_name: 'Juan Pérez', p_phone: '11 4444-0000', p_email: 'juan@correo.test' }))
      expect(await screen.findByText('Datos actualizados')).toBeInTheDocument()
      expect(await screen.findByText('11 4444-0000')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    })

    it('conserva la validación del nombre y permite cancelar sin guardar', async () => {
      const { client, rpc } = makeClient({ player_profile: () => ({ data: profile, error: null }) })
      await openProfile(client)
      fireEvent.click(screen.getByRole('button', { name: 'Editar mis datos' }))
      fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: '   ' } })
      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(rpc).not.toHaveBeenCalledWith('update_player_profile', expect.anything())
      expect(screen.getByRole('heading', { name: 'Juan Pérez' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Editar mis datos' }))
      expect(screen.getByLabelText(/Nombre/)).toHaveValue('Juan Pérez')
    })

    it('si el servidor rechaza el cambio se mantiene el formulario con el aviso de error', async () => {
      const { client } = makeClient({ player_profile: () => ({ data: profile, error: null }), update_player_profile: () => ({ data: null, error: { message: 'x' } }) })
      await openProfile(client)
      fireEvent.click(screen.getByRole('button', { name: 'Editar mis datos' }))
      fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '11 1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
      expect(await screen.findByText('No se guardaron los cambios')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    })
  })

  describe('Ranking dentro de Torneos', () => {
    const rankingPayload = { season: 2026, seasons: [2026], modality: 'singles', my_person_id: 'person-a', rows: [
      { position: 1, person_id: 'person-x', name: 'Ana Gómez', points: 100, tournaments: 1, titles: 1, runner_ups: 0 },
      { position: 2, person_id: 'person-a', name: 'Juan Pérez', points: 60, tournaments: 1, titles: 0, runner_ups: 1 },
    ] }

    it('se abre desde la pestaña Ranking de Torneos (no hay otra sección en la barra) y destaca la posición propia', async () => {
      const { client, rpc } = makeClient({ club_ranking: () => ({ data: rankingPayload, error: null }) })
      renderPortal(client)
      fireEvent.click((await screen.findAllByRole('button', { name: /Torneos/ }))[0])
      expect(screen.queryByRole('button', { name: /^Ranking/ })).not.toBeInTheDocument()
      fireEvent.click(await screen.findByRole('tab', { name: 'Ranking' }))
      const list = await screen.findByRole('list', { name: 'Ranking Singles 2026' })
      expect(rpc).toHaveBeenCalledWith('club_ranking', { p_club_id: 'club-a', p_season: null, p_modality: 'singles' })
      const items = within(list).getAllByRole('listitem')
      expect(items[1]).toHaveClass('is-mine')
      expect(within(items[1]).getByText('Vos')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: 'Torneos' }))
      expect(await screen.findByText('No hay torneos publicados')).toBeInTheDocument()
    })
  })

  it('permite cambiar a administración solo cuando la cuenta tiene ese acceso', async () => {
    const onOpenAdmin = vi.fn()
    const { client } = makeClient()
    renderPortal(client, [clubA], onOpenAdmin)
    fireEvent.click(await screen.findByRole('button', { name: 'Cuenta' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar a administración' }))
    expect(onOpenAdmin).toHaveBeenCalled()
  })

  it('no ofrece cambiar a administración a una cuenta solo de jugador', async () => {
    const { client } = makeClient()
    renderPortal(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Cuenta' }))
    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar a administración' })).not.toBeInTheDocument()
  })

  describe('Novedades y avisos', () => {
    const shiftDay = (days: number) => { const date = new Date(Date.now() + days * 86_400_000); return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date) }
    const post = (id: string, patch: Record<string, unknown> = {}) => ({ id, kind: 'news', title: `Título ${id}`, body: `Descripción ${id}`, is_featured: false, event_date: null, event_time: null, location: null, image_path: null, tournament_id: null, published_at: '2026-10-01T12:00:00Z', ...patch })

    it('consulta las novedades solo del club elegido y las muestra en su sección', async () => {
      const { client, rpc } = makeClient({
        club_posts_feed: () => ({ data: [post('n1', { title: 'Cierre por lluvia' }), post('e1', { kind: 'event', title: 'Peña de fin de mes', event_date: shiftDay(5), event_time: '21:00:00', location: 'Quincho' })], error: null }),
      })
      renderPortal(client)
      expect(await screen.findByRole('heading', { name: 'Hola, Juan' })).toBeInTheDocument()
      expect(rpc).toHaveBeenCalledWith('club_posts_feed', { p_club_id: 'club-a' })
      // Inicio ofrece el próximo evento y lleva a Novedades.
      fireEvent.click(await screen.findByRole('button', { name: /Próximo evento/ }))
      expect(await screen.findByRole('heading', { name: 'Novedades' })).toBeInTheDocument()
      expect(screen.getByText('Cierre por lluvia')).toBeInTheDocument()
      expect(within(screen.getByRole('region', { name: 'Próximos eventos' })).getByText('Peña de fin de mes')).toBeInTheDocument()
    })

    it('los borradores no llegan al portal: el servidor solo devuelve publicadas y la pantalla no inventa otras', async () => {
      const { client } = makeClient({ club_posts_feed: () => ({ data: [], error: null }) })
      renderPortal(client)
      fireEvent.click((await screen.findAllByRole('button', { name: 'Cuenta' }))[0])
      fireEvent.click(await screen.findByRole('button', { name: 'Novedades del club' }))
      expect(await screen.findByText('Todavía no hay novedades')).toBeInTheDocument()
    })

    it('al cambiar de club se piden y muestran las novedades del otro club', async () => {
      const { client, rpc } = makeClient({
        club_posts_feed: (args) => ({ data: args.p_club_id === 'club-a' ? [post('a1', { title: 'Del club A' })] : [post('b1', { title: 'Del club B' })], error: null }),
      })
      renderPortal(client, [clubA, clubB])
      fireEvent.click((await screen.findAllByRole('button', { name: 'Cuenta' }))[0])
      fireEvent.click(await screen.findByRole('button', { name: 'Novedades del club' }))
      expect(await screen.findByText('Del club A')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }))
      fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Club'), { target: { value: 'club-b' } })
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('club_posts_feed', { p_club_id: 'club-b' }))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Cuenta' }))[0])
      fireEvent.click(await screen.findByRole('button', { name: 'Novedades del club' }))
      expect(await screen.findByText('Del club B')).toBeInTheDocument()
      expect(screen.queryByText('Del club A')).not.toBeInTheDocument()
    })

    it('abrir un aviso de publicación lleva a Novedades con el detalle abierto; uno de reserva lleva a Mis turnos', async () => {
      const notification = (id: string, target_type: 'post' | 'reservation', target_id: string) => ({ id, club_id: 'club-a', kind: target_type === 'post' ? 'news_published' : 'reservation_confirmed', title: `Aviso ${id}`, body: null, target_type, target_id, created_at: new Date().toISOString(), read_at: null })
      const { client, rpc } = makeClient({
        club_posts_feed: () => ({ data: [post('p9', { title: 'Publicación del aviso', body: 'Detalle completo.' })], error: null }),
        my_notifications: () => ({ data: { unread: 2, items: [notification('n-post', 'post', 'p9'), notification('n-res', 'reservation', 'r1')] }, error: null }),
      })
      renderPortal(client)
      fireEvent.click(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' }))
      fireEvent.click(await screen.findByRole('button', { name: /Aviso n-post/ }))
      expect(await screen.findByRole('dialog', { name: 'Publicación del aviso' })).toBeInTheDocument()
      expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: 'n-post' })
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Publicación del aviso' })).getAllByRole('button', { name: 'Cerrar' })[0])
      fireEvent.click(screen.getByRole('button', { name: /^Avisos/ }))
      fireEvent.click(await screen.findByRole('button', { name: /Aviso n-res/ }))
      expect(await screen.findByRole('heading', { name: 'Mis turnos' })).toBeInTheDocument()
    })
  })
})
