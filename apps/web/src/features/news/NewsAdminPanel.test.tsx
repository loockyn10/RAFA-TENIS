import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { AdminClubPost, Club, PostStatus } from '../../types/domain'
import { NewsAdminPanel } from './NewsAdminPanel'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }

const admin = (id: string, status: PostStatus, patch: Partial<AdminClubPost> = {}): AdminClubPost => ({
  id, club_id: 'club-1', kind: 'news', title: `Publicación ${id}`, body: 'Texto de la publicación.', status, is_featured: false, event_date: null, event_time: null, location: null,
  image_path: null, tournament_id: null, published_at: status === 'draft' ? null : '2026-10-01T12:00:00Z', archived_at: status === 'archived' ? '2026-10-02T12:00:00Z' : null,
  notified_at: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...patch,
})

type RpcHandler = (args: Record<string, unknown>) => unknown
function makeClient(posts: AdminClubPost[], handlers: Record<string, RpcHandler> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const handler = handlers[name]
    if (handler) return handler(args)
    if (name === 'create_club_post') return { data: admin('new-1', 'draft', { title: String(args.p_title), kind: args.p_kind as 'news' | 'event' }), error: null }
    if (name === 'update_club_post') return { data: admin(String(args.p_post_id), 'draft'), error: null }
    if (name === 'publish_club_post') return { data: { id: args.p_post_id, status: 'published', notified: Boolean(args.p_notify), already_notified: false, recipients: args.p_notify ? 3 : 0 }, error: null }
    if (name === 'archive_club_post') return { data: admin(String(args.p_post_id), 'archived'), error: null }
    if (name === 'club_posts_feed') return { data: posts.filter((post) => post.status === 'published'), error: null }
    return { data: null, error: null }
  })
  const chain = (rows: unknown[]) => { const query: Record<string, unknown> = {}; for (const method of ['select', 'eq', 'neq', 'in', 'order']) query[method] = () => query; query.limit = () => Promise.resolve({ data: rows, error: null }); return query }
  const from = vi.fn((table: string) => chain(table === 'club_posts' ? posts : []))
  const storage = { from: () => ({ createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }), upload: vi.fn(), remove: vi.fn() }) }
  const client = { rpc, from, storage, functions: { invoke: vi.fn() } } as unknown as SupabaseClient
  return { client, rpc, from }
}

const renderPanel = (client: SupabaseClient, canManage = true) => render(<NewsAdminPanel client={client} club={club} canManage={canManage} />)
const rpcNames = (rpc: ReturnType<typeof makeClient>['rpc']) => rpc.mock.calls.map(([name]) => name)
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } })

describe('NewsAdminPanel — administración de publicaciones', () => {
  it('muestra Publicadas por defecto y separa borradores y archivadas en sus pestañas', async () => {
    const { client } = makeClient([admin('a', 'published'), admin('b', 'draft'), admin('c', 'archived')])
    renderPanel(client)
    expect(await screen.findByText('Publicación a')).toBeInTheDocument()
    expect(screen.queryByText('Publicación b')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Borradores/ }))
    expect(screen.getByText('Publicación b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Archivadas/ }))
    expect(screen.getByText('Publicación c')).toBeInTheDocument()
  })

  it('guardar un borrador crea la publicación y NO publica ni avisa', async () => {
    const { client, rpc } = makeClient([])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fill('Título', 'Nuevo horario de la cantina')
    fill('Descripción', 'Abre desde las 8.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await waitFor(() => expect(rpcNames(rpc)).toContain('create_club_post'))
    const [, args] = rpc.mock.calls.find(([name]) => name === 'create_club_post')!
    expect(args).toMatchObject({ p_club_id: 'club-1', p_kind: 'news', p_title: 'Nuevo horario de la cantina', p_event_date: null, p_client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(rpcNames(rpc)).not.toContain('publish_club_post')
    expect(await screen.findByText(/Borrador guardado/)).toBeInTheDocument()
  })

  it('un evento se publica con aviso: crea y luego publica con notify=true (aviso marcado de entrada)', async () => {
    const { client, rpc } = makeClient([])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fireEvent.click(screen.getByRole('tab', { name: /Evento/ }))
    fill('Título', 'Peña de fin de mes')
    fill('Descripción', 'Asado y música.')
    fill('Fecha', '2099-11-01')
    fill('Hora', '21:00')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar…' }))
    const toggle = await screen.findByRole('switch', { name: /Avisar a los jugadores/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar y avisar' }))
    expect(await screen.findByText(/Avisamos a 3 jugadores/)).toBeInTheDocument()
    expect(rpcNames(rpc)).toEqual(expect.arrayContaining(['create_club_post', 'publish_club_post']))
    expect(rpc.mock.calls.find(([name]) => name === 'create_club_post')![1]).toMatchObject({ p_kind: 'event', p_event_date: '2099-11-01', p_event_time: '21:00' })
    expect(rpc.mock.calls.find(([name]) => name === 'publish_club_post')![1]).toMatchObject({ p_notify: true })
  })

  it('se puede publicar sin avisar', async () => {
    const { client, rpc } = makeClient([])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fireEvent.click(screen.getByRole('tab', { name: /Evento/ }))
    fill('Título', 'Jornada de tenis'); fill('Descripción', 'Todo el día.'); fill('Fecha', '2099-11-01')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar…' }))
    fireEvent.click(await screen.findByRole('switch', { name: /Avisar a los jugadores/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(rpcNames(rpc)).toContain('publish_club_post'))
    expect(rpc.mock.calls.find(([name]) => name === 'publish_club_post')![1]).toMatchObject({ p_notify: false })
  })

  it('un comunicado sin destacar no ofrece aviso; destacado sí', async () => {
    const { client } = makeClient([])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fill('Título', 'Cierre por lluvia'); fill('Descripción', 'Hoy no abrimos.')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar…' }))
    expect(await screen.findByText(/solo envían aviso si están destacados/)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /Avisar a los jugadores/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    fireEvent.click(screen.getByRole('switch', { name: /Destacar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar…' }))
    expect(await screen.findByRole('switch', { name: /Avisar a los jugadores/ })).toBeInTheDocument()
  })

  it('valida antes de enviar: HTML, descripción vacía y fecha pasada no llegan al servidor', async () => {
    const { client, rpc } = makeClient([])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fill('Título', 'Hola <script>alert(1)</script>')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText(/no se admite código HTML/)).toBeInTheDocument()
    expect(screen.getByText('La descripción es obligatoria.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Evento/ }))
    fill('Título', 'Evento válido'); fill('Descripción', 'Texto'); fill('Fecha', '2020-01-02')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText('La fecha del evento no puede estar en el pasado.')).toBeInTheDocument()
    expect(rpcNames(rpc)).not.toContain('create_club_post')
  })

  it('muestra el mensaje del servidor si rechaza la publicación y no declara éxito', async () => {
    const { client } = makeClient([], { create_club_post: () => ({ data: null, error: { code: '22023', message: 'El título debe tener entre 3 y 140 caracteres.' } }) })
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva publicación' }))
    fill('Título', 'Título válido'); fill('Descripción', 'Texto')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText('El título debe tener entre 3 y 140 caracteres.')).toBeInTheDocument()
    expect(screen.queryByText(/Borrador guardado/)).not.toBeInTheDocument()
  })

  it('publicar un borrador existente envía una sola solicitud aunque se haga doble clic', async () => {
    let resolve: (value: unknown) => void = () => undefined
    const { client, rpc } = makeClient([admin('d', 'draft')], { publish_club_post: () => new Promise((done) => { resolve = done }) })
    renderPanel(client)
    fireEvent.click(await screen.findByRole('tab', { name: /Borradores/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publicar' })
    const confirm = within(dialog).getAllByRole('button').find((button) => /^Publicar/.test(button.textContent ?? ''))!
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(rpc.mock.calls.filter(([name]) => name === 'publish_club_post')).toHaveLength(1)
    resolve({ data: { id: 'd', status: 'published', notified: false, already_notified: false, recipients: 0 }, error: null })
    expect(await screen.findByText('Publicada.')).toBeInTheDocument()
  })

  it('reintentar una publicación ya avisada informa que no se repite', async () => {
    const { client } = makeClient([admin('p', 'published', { kind: 'event', event_date: '2099-11-01', notified_at: null })], {
      publish_club_post: () => ({ data: { id: 'p', status: 'published', notified: false, already_notified: true, recipients: 0 }, error: null }),
    })
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar aviso' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Enviar aviso' })).getByRole('button', { name: 'Enviar aviso' }))
    expect(await screen.findByText(/El aviso ya se había enviado antes/)).toBeInTheDocument()
  })

  it('archiva con confirmación', async () => {
    const { client, rpc } = makeClient([admin('a', 'published')])
    renderPanel(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Archivar' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Archivar publicación' })).getByRole('button', { name: 'Archivar' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('archive_club_post', { p_post_id: 'a' }))
    expect(await screen.findByText(/Archivada. Ya no se ve en el portal/)).toBeInTheDocument()
  })

  it('el personal operativo solo consulta lo publicado: sin botones de administración y leyendo el feed, no la tabla', async () => {
    const { client, rpc, from } = makeClient([admin('a', 'published'), admin('b', 'draft')])
    renderPanel(client, false)
    expect(await screen.findByText('Publicación a')).toBeInTheDocument()
    expect(screen.queryByText('Publicación b')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva publicación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('club_posts_feed', { p_club_id: 'club-1' })
    expect(from).not.toHaveBeenCalledWith('club_posts')
  })

  it('muestra un estado vacío útil y un error con reintento', async () => {
    const empty = makeClient([])
    const { unmount } = renderPanel(empty.client)
    expect(await screen.findByText('No hay publicaciones visibles')).toBeInTheDocument()
    unmount()
    const failing = makeClient([])
    failing.from.mockImplementation(() => { const query: Record<string, unknown> = {}; for (const method of ['select', 'eq', 'neq', 'order']) query[method] = () => query; query.limit = () => Promise.resolve({ data: null, error: { message: 'x' } }); return query as never })
    renderPanel(failing.client)
    expect(await screen.findByText('No pudimos cargar las novedades')).toBeInTheDocument()
  })
})
