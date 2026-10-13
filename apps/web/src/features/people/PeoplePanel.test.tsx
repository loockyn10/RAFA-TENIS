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
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fullName: ' Martín González ', active: true })))
  })

  it('edita datos y permite desactivar sin eliminar la ficha', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<PersonEditor person={person} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Teléfono (opcional)'), { target: { value: '11 4444 3333' } })
    fireEvent.click(screen.getByLabelText('Jugador activo'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '11 4444 3333', active: false })))
  })
})
