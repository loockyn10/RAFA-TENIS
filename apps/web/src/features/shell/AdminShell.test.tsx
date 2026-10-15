import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Club } from '../../types/domain'
import { AdminShell, type AdminShellProps } from './AdminShell'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }

function setup(overrides: Partial<AdminShellProps> = {}) {
  const props: AdminShellProps = {
    section: 'home', onNavigate: vi.fn(), club, clubs: [club], onSelectClub: vi.fn(), role: 'owner', canManage: true, userEmail: 'rafa@club.test',
    onSignOut: vi.fn(), signingOut: false, onNewReservation: vi.fn(), onNewBlock: vi.fn(), onNewLesson: vi.fn(), onNewPerson: vi.fn(), ...overrides,
  }
  render(<AdminShell {...props}><p>Contenido real</p></AdminShell>)
  return props
}
const sidebar = () => within(screen.getByRole('navigation', { name: 'Secciones administrativas' }))

describe('AdminShell', () => {
  it('muestra Cuotas y Portal de jugadores solo a quienes administran el club', () => {
    setup()
    expect(sidebar().getByRole('button', { name: /Cuotas/ })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: /Portal de jugadores/ })).toBeInTheDocument()
  })

  it('oculta las secciones restringidas al personal operativo y no ofrece cobrar cuotas', () => {
    setup({ role: 'staff', canManage: false })
    expect(sidebar().queryByRole('button', { name: /Cuotas/ })).not.toBeInTheDocument()
    expect(sidebar().queryByRole('button', { name: /Portal de jugadores/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    const dialog = screen.getByRole('dialog', { name: 'Crear' })
    expect(within(dialog).queryByRole('button', { name: 'Cuotas y pagos' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Nueva reserva' })).toBeInTheDocument()
  })

  it('navega a la sección real elegida y marca la actual', () => {
    const props = setup({ section: 'canteen' })
    expect(sidebar().getByRole('button', { name: /Cantina/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(sidebar().getByRole('button', { name: /Reservas/ }))
    expect(props.onNavigate).toHaveBeenCalledWith('reservations')
  })

  it('el botón central abre operaciones reales: cada tile invoca su acción', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    const dialog = screen.getByRole('dialog', { name: 'Crear' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bloquear cancha' }))
    expect(props.onNewBlock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Crear' })).getByRole('button', { name: 'Nuevo jugador' }))
    expect(props.onNewPerson).toHaveBeenCalledTimes(1)
  })

  it('la cuenta ofrece cierre de sesión, cambio de club y portal solo cuando corresponde', () => {
    const second: Club = { id: 'club-2', name: 'Otro Club', timezone: club.timezone }
    const props = setup({ clubs: [club, second], onOpenPlayerPortal: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: /Cuenta/, expanded: false }))
    const account = screen.getByRole('dialog', { name: 'Cuenta' })
    expect(within(account).getByText(/Propietario · Rafa Tenis/)).toBeInTheDocument()
    fireEvent.change(within(account).getByLabelText('Club'), { target: { value: 'club-2' } })
    expect(props.onSelectClub).toHaveBeenCalledWith('club-2')
    fireEvent.click(within(account).getByRole('button', { name: 'Mi portal de jugador' }))
    expect(props.onOpenPlayerPortal).toHaveBeenCalled()
    fireEvent.click(within(account).getByRole('button', { name: 'Cerrar sesión' }))
    expect(props.onSignOut).toHaveBeenCalled()
  })

  it('no muestra «Mi portal» ni selector de club sin accesos múltiples', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Cuenta/, expanded: false }))
    const account = screen.getByRole('dialog', { name: 'Cuenta' })
    expect(within(account).queryByLabelText('Club')).not.toBeInTheDocument()
    expect(within(account).queryByRole('button', { name: 'Mi portal de jugador' })).not.toBeInTheDocument()
  })

  it('Novedades está disponible para todo el personal (el staff solo consulta) y se navega a ella', () => {
    const props = setup({ role: 'staff', canManage: false })
    fireEvent.click(sidebar().getByRole('button', { name: /Novedades/ }))
    expect(props.onNavigate).toHaveBeenCalledWith('news')
  })

  it('muestra la campanita de avisos cuando el panel la provee y no ocupa la barra inferior', () => {
    setup({ notifications: <button type="button">Avisos de prueba</button> })
    expect(screen.getByRole('button', { name: 'Avisos de prueba' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Accesos principales' })).queryByRole('button', { name: /Novedades/ })).not.toBeInTheDocument()
  })
})
