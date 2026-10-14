import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MembershipDue } from '../../types/domain'
import { UNCERTAIN_RESULT_MESSAGE } from '../../lib/idempotency'
import { PaymentDialog } from './FinancePanel'

const due: MembershipDue = { id: 'due-juan', club_id: 'club-1', membership_id: 'm-1', period: '2026-10-01', amount_cents: 6000000, due_date: '2026-10-10', created_at: '', created_by: 'u-1' }

describe('PaymentDialog de cuotas (SEC-05)', () => {
  it('doble clic al registrar: el pago se envía una sola vez', async () => {
    let finish: (value: string | null) => void = () => undefined
    const onSave = vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve }))
    render(<PaymentDialog due={due} payments={[]} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/Importe recibido/), { target: { value: '20000' } })
    const form = screen.getByRole('button', { name: 'Registrar pago' }).closest('form') as HTMLFormElement
    act(() => { fireEvent.submit(form); fireEvent.submit(form); fireEvent.submit(form) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2000000, paymentMethod: 'cash' }))
    expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled()
    await act(async () => { finish(null) })
  })

  it('resultado incierto: conserva lo cargado y ofrece reintentar el MISMO pago', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(UNCERTAIN_RESULT_MESSAGE).mockResolvedValueOnce(null)
    render(<PaymentDialog due={due} payments={[]} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/Importe recibido/), { target: { value: '20000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos confirmar si la operación se registró')
    expect(screen.getByLabelText(/Importe recibido/)).toHaveValue('20000')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar pago' }))
    await act(async () => { await Promise.resolve() })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0])
  })
})
