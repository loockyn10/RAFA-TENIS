import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CourtList } from './CourtList'
import type { Court } from '../../types/domain'

const courts: Court[] = [
  { id: '6', club_id: 'club-1', name: 'Cancha 6', surface: 'Polvo de ladrillo', active: true, display_order: 6 },
  { id: '2', club_id: 'club-1', name: 'Cancha 2', surface: 'Polvo de ladrillo', active: true, display_order: 2 },
  { id: '5', club_id: 'club-1', name: 'Cancha 5', surface: 'Polvo de ladrillo', active: true, display_order: 5 },
  { id: '1', club_id: 'club-1', name: 'Cancha 1', surface: 'Polvo de ladrillo', active: true, display_order: 1 },
  { id: '4', club_id: 'club-1', name: 'Cancha 4', surface: 'Polvo de ladrillo', active: true, display_order: 4 },
  { id: '3', club_id: 'club-1', name: 'Cancha 3', surface: 'Polvo de ladrillo', active: false, display_order: 3 },
]

describe('CourtList', () => {
  it('muestra las seis canchas en orden de visualización', () => {
    render(<CourtList courts={courts} canManage={false} onSave={vi.fn()} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Cancha 1', 'Cancha 2', 'Cancha 3', 'Cancha 4', 'Cancha 5', 'Cancha 6',
    ])
  })

  it('diferencia lectura de administración y muestra un error de persistencia', async () => {
    const rejectedSave = vi.fn().mockResolvedValue({ error: 'No se pudieron guardar los cambios.' })
    const { rerender } = render(<CourtList courts={courts} canManage={false} onSave={rejectedSave} />)

    expect(screen.queryByRole('button', { name: 'Guardar cancha' })).not.toBeInTheDocument()

    rerender(<CourtList courts={courts} canManage onSave={rejectedSave} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar cancha' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar cancha' })[0])

    expect(await screen.findByText('No se pudieron guardar los cambios.')).toBeInTheDocument()
  })
})
