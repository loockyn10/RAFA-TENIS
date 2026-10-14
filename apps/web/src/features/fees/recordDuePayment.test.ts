import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Club, MembershipDue } from '../../types/domain'
import { KEY_CONFLICT_MESSAGE, UNCERTAIN_RESULT_MESSAGE, releaseOperationKey } from '../../lib/idempotency'
import { recordDuePayment, type DuePaymentPayload } from './recordDuePayment'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const due: MembershipDue = { id: 'due-juan', club_id: 'club-1', membership_id: 'm-1', period: '2026-10-01', amount_cents: 6000000, due_date: '2026-10-10', created_at: '', created_by: 'u-1' }
const payment = (overrides: Partial<DuePaymentPayload> = {}): DuePaymentPayload => ({ amountCents: 2000000, paymentDate: '2026-10-14', paymentMethod: 'cash', reference: '', notes: '', ...overrides })
const networkError = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }

// Cliente falso: rpc devuelve un objeto con abortSignal (como PostgrestFilterBuilder) y from() la consulta de recuperación.
function fakeClient(results: Array<unknown>, lookup: { data: unknown; error: unknown } = { data: null, error: null }) {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve(results.shift() ?? { data: null, error: null }) }))
  const maybeSingle = vi.fn(() => Promise.resolve(lookup))
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq']) chain[name] = vi.fn(() => chain)
  chain.maybeSingle = maybeSingle
  const from = vi.fn(() => chain)
  return { client: { rpc, from } as never, rpc, from, maybeSingle, chain }
}
const keyOf = (rpc: ReturnType<typeof vi.fn>, call: number) => ((rpc.mock.calls[call] as unknown) as [string, Record<string, unknown>])[1].p_client_request_id

beforeEach(() => { window.sessionStorage.clear(); releaseOperationKey(`due-payment:${club.id}:${due.id}`) })

describe('recordDuePayment (SEC-05)', () => {
  it('pago normal: envía la clave idempotente y los datos normalizados', async () => {
    const { client, rpc } = fakeClient([{ data: { id: 'p1' }, error: null }])
    const result = await recordDuePayment(client, club, due, payment({ reference: '  ', notes: '' }))
    expect(result).toEqual({ ok: true, recovered: false })
    expect(rpc).toHaveBeenCalledWith('record_membership_due_payment', expect.objectContaining({ p_club_id: 'club-1', p_due_id: 'due-juan', p_amount_cents: 2000000, p_payment_date: '2026-10-14', p_payment_method: 'cash', p_reference: null, p_notes: null }))
    expect(keyOf(rpc, 0)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('respuesta de Supabase perdida y reintento del MISMO pago: misma clave, sin pago adicional', async () => {
    const { client, rpc, maybeSingle } = fakeClient([networkError, { data: { id: 'p1' }, error: null }])
    const first = await recordDuePayment(client, club, due, payment())
    expect(first).toEqual({ ok: false, message: UNCERTAIN_RESULT_MESSAGE })
    expect(maybeSingle).toHaveBeenCalledTimes(1) // intentó recuperar el pago antes de rendirse
    const retry = await recordDuePayment(client, club, due, payment())
    expect(retry).toEqual({ ok: true, recovered: false })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(keyOf(rpc, 1)).toBe(keyOf(rpc, 0))
  })

  it('si el pago ya estaba registrado, lo recupera por su clave sin reenviarlo', async () => {
    const { client, rpc } = fakeClient([networkError], { data: { id: 'p-original' }, error: null })
    expect(await recordDuePayment(client, club, due, payment())).toEqual({ ok: true, recovered: true })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('un segundo pago LEGÍTIMO del mismo importe, hecho después de confirmar el primero, usa otra clave', async () => {
    const { client, rpc } = fakeClient([{ data: { id: 'p1' }, error: null }, { data: { id: 'p2' }, error: null }])
    await recordDuePayment(client, club, due, payment())
    await recordDuePayment(client, club, due, payment())
    expect(keyOf(rpc, 1)).not.toBe(keyOf(rpc, 0))
  })

  it('si el usuario cambia el importe tras un error incierto, es otro pago y usa otra clave', async () => {
    const { client, rpc } = fakeClient([networkError, { data: { id: 'p2' }, error: null }])
    await recordDuePayment(client, club, due, payment({ amountCents: 2000000 }))
    await recordDuePayment(client, club, due, payment({ amountCents: 2500000 }))
    expect(keyOf(rpc, 1)).not.toBe(keyOf(rpc, 0))
  })

  it('rechazo del servidor (sobrepago): mensaje claro y la misma clave si reintenta el mismo pago', async () => {
    const { client, rpc, maybeSingle } = fakeClient([{ data: null, error: { code: '22023', message: 'El importe supera el saldo pendiente de la cuota.' } }, { data: { id: 'p1' }, error: null }])
    const first = await recordDuePayment(client, club, due, payment())
    expect(first.ok).toBe(false)
    expect(maybeSingle).not.toHaveBeenCalled()
    await recordDuePayment(client, club, due, payment())
    expect(keyOf(rpc, 1)).toBe(keyOf(rpc, 0))
  })

  it('clave usada con otros datos (23505): mensaje específico y clave nueva en el próximo intento', async () => {
    const { client, rpc } = fakeClient([{ data: null, error: { code: '23505', message: 'x' } }, { data: { id: 'p1' }, error: null }])
    expect(await recordDuePayment(client, club, due, payment())).toEqual({ ok: false, message: KEY_CONFLICT_MESSAGE })
    await recordDuePayment(client, club, due, payment())
    expect(keyOf(rpc, 1)).not.toBe(keyOf(rpc, 0))
  })

  it('consulta de recuperación acotada al club y a la clave', async () => {
    const { client, chain } = fakeClient([networkError])
    await recordDuePayment(client, club, due, payment())
    expect(chain.eq).toHaveBeenCalledWith('club_id', 'club-1')
    expect(chain.eq).toHaveBeenCalledWith('client_request_id', expect.stringMatching(/^[0-9a-f-]{36}$/))
  })
})
