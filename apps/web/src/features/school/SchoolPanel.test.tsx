import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Club, ClubCoach, Court, LessonDraft } from '../../types/domain'
import { LessonForm } from './SchoolPanel'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const courts: Court[] = [{ id: 'court-1', club_id: 'club-1', name: 'Cancha 1', surface: 'Polvo de ladrillo', active: true, display_order: 1 }]
const coach: ClubCoach & { person: { full_name: string } } = { id: 'coach-1', club_id: 'club-1', person_id: 'person-coach', active: true, notes: null, created_at: '', updated_at: '', person: { full_name: 'Martín' } }
const draft: LessonDraft = { coachId: 'coach-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:00', lessonType: 'individual', capacity: 1, studentIds: [], notes: '', recurrence: 'single', recurrenceUntil: '2026-10-13' }

describe('LessonForm', () => {
  it('crea una clase individual sin alumnos y conserva el cupo uno', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn(), rpc } as never
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<LessonForm client={client} club={club} courts={courts} coaches={[coach]} initial={draft} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Crear clase' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_tennis_lesson', expect.objectContaining({ p_club_id: 'club-1', p_coach_id: 'coach-1', p_capacity: 1, p_student_ids: [] })))
  })

  it('solicita la creación atómica de una serie semanal', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn(), rpc } as never
    render(<LessonForm client={client} club={club} courts={courts} coaches={[coach]} initial={draft} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Repetir semanalmente'))
    fireEvent.change(screen.getByLabelText('Última fecha de la serie'), { target: { value: '2026-11-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear serie' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_weekly_tennis_lesson_series', expect.objectContaining({ p_occurrence_count: 4 })))
  })
})
