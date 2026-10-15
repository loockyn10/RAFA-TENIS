import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClubPerson } from '../../types/domain'
import { PersonEditor } from './PeoplePanel'

const person: ClubPerson = {
  id: 'person-1', club_id: 'club-1', full_name: 'Ana Pérez', phone: '11 5555 0000', email: null, notes: null, active: true,
  created_at: '2026-10-13T00:00:00.000Z', updated_at: '2026-10-13T00:00:00.000Z',
}

describe('PersonEditor', () => {
  it('crea un jugador solo con el nombre', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<PersonEditor onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: ' Martín González ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear jugador' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fullName: ' Martín González ', active: true }), false))
  })

  it('edita datos conservando el estado de la ficha (la baja lógica se hace desde la ficha)', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<PersonEditor person={person} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '11 4444 3333' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '11 4444 3333', active: true, fullName: 'Ana Pérez' }), false))
  })
})

describe('PersonEditor · membresía', () => {
  it('solo ofrece la membresía a quien puede administrarla', () => {
    const { unmount } = render(<PersonEditor onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: 'Socio' })).not.toBeInTheDocument()
    unmount()
    render(<PersonEditor canManageMemberships today="2026-10-14" onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Socio' })).toBeInTheDocument()
  })

  it('avisa si ya existe una ficha con el mismo nombre', () => {
    render(<PersonEditor people={[person]} onClose={vi.fn()} onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'ana pérez' } })
    expect(screen.getByText('Ya existe una ficha con ese nombre')).toBeInTheDocument()
  })
})
