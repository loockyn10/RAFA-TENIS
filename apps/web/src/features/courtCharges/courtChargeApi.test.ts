import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Club } from '../../types/domain'
import { KEY_CONFLICT_MESSAGE, UNCERTAIN_RESULT_MESSAGE, releaseOperationKey } from '../../lib/idempotency'
import { createCourtCharge, recordCourtChargePayment, voidCourtCharge, type ChargeInput } from './courtChargeApi'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const input = (patch: Partial<ChargeInput> = {}): ChargeInput => ({ reservationId: 'res-1', responsiblePersonId: 'p-1', applyRental: true, applyLighting: false, billableMinutes: 60, rentalOverrideCents: null, lightingOverrideCents: null, adjustmentReason: '', notes: '', ...patch })
const networkError = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }

function fakeClient(results: unknown[], lookup: { data: unknown; error: unknown } = { data: null, error: null }) {
  const rpc = vi.fn(() => {
    const result = Promise.resolve(results.shift() ?? { data: null, error: null })
    return Object.assign(result, { abortSignal: () => result })
  })
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq']) chain[name] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve(lookup))
  return { client: { rpc, from: vi.fn(() => chain) } as never, rpc }
}
const keyOf = (rpc: ReturnType<typeof vi.fn>, call: number) => ((rpc.mock.calls[call] as unknown) as [string, Record<string, unknown>])[1].p_client_request_id
const args = (rpc: ReturnType<typeof vi.fn>, call: number) => ((rpc.mock.calls[call] as unknown) as [string, Record<string, unknown>])[1]

beforeEach(() => { window.sessionStorage.clear(); releaseOperationKey('court-charge:club-1:res-1'); releaseOperationKey('court-payment:club-1:ch-1') })

describe('createCourtCharge (cargo con confirmación expresa e idempotente)', () => {
  it('envía el cargo con clave, sin precios inventados por el cliente (solo importes manuales explícitos)', async () => {
    const { client, rpc } = fakeClient([{ data: { id: 'ch-1' }, error: null }])
    const result = await createCourtCharge(client, club, input({ notes: '  ' }))
    expect(result).toMatchObject({ ok: true, recovered: false })
    expect(rpc).toHaveBeenCalledWith('create_court_charge', expect.objectContaining({ p_club_id: 'club-1', p_reservation_id: 'res-1', p_responsible_person_id: 'p-1', p_apply_rental: true, p_apply_lighting: false, p_billable_minutes: 60, p_rental_override_cents: null, p_notes: null }))
    expect(keyOf(rpc, 0)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('respuesta perdida + reintento del MISMO cargo: misma clave (el servidor devuelve el original)', async () => {
    const { client, rpc } = fakeClient([networkError, { data: { id: 'ch-1' }, error: null }])
    expect(await createCourtCharge(client, club, input())).toEqual({ ok: false, message: UNCERTAIN_RESULT_MESSAGE })
    expect(await createCourtCharge(client, club, input())).toMatchObject({ ok: true })
    expect(keyOf(rpc, 1)).toBe(keyOf(rpc, 0))
  })

  it('si el cargo ya estaba registrado, lo recupera por su clave sin reenviarlo', async () => {
    const { client, rpc } = fakeClient([networkError], { data: { id: 'ch-original' }, error: null })
    expect(await createCourtCharge(client, club, input())).toMatchObject({ ok: true, recovered: true })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('si Rafa cambia el contenido (otro responsable o importe) tras un error incierto, es otro cargo: otra clave', async () => {
    const { client, rpc } = fakeClient([networkError, { data: { id: 'ch-2' }, error: null }])
    await createCourtCharge(client, club, input())
    await createCourtCharge(client, club, input({ applyLighting: true }))
    expect(keyOf(rpc, 1)).not.toBe(keyOf(rpc, 0))
  })

  it('un rechazo de negocio del servidor se muestra tal cual y conserva la clave', async () => {
    const { client } = fakeClient([{ data: null, error: { code: '22023', message: 'La reserva ya tiene un cargo vigente. Anulalo antes de registrar otro.' } }])
    expect(await createCourtCharge(client, club, input())).toEqual({ ok: false, message: 'La reserva ya tiene un cargo vigente. Anulalo antes de registrar otro.' })
  })

  it('clave usada con otro contenido (23505): mensaje específico', async () => {
    const { client } = fakeClient([{ data: null, error: { code: '23505', message: 'x' } }])
    expect(await createCourtCharge(client, club, input())).toEqual({ ok: false, message: KEY_CONFLICT_MESSAGE })
  })

  it('los importes manuales y su motivo se envían tal cual', async () => {
    const { client, rpc } = fakeClient([{ data: { id: 'ch-1' }, error: null }])
    await createCourtCharge(client, club, input({ rentalOverrideCents: 900000, adjustmentReason: ' Acordado ' }))
    expect(args(rpc, 0)).toMatchObject({ p_rental_override_cents: 900000, p_adjustment_reason: 'Acordado' })
  })
})

describe('recordCourtChargePayment', () => {
  const payment = { amountCents: 500000, paymentDate: '2026-10-14', paymentMethod: 'cash' as const, reference: '', notes: '' }
  it('pago con clave; reintento del mismo pago reutiliza la clave', async () => {
    const { client, rpc } = fakeClient([networkError, { data: { id: 'p1' }, error: null }])
    expect(await recordCourtChargePayment(client, club, 'ch-1', payment)).toEqual({ ok: false, message: UNCERTAIN_RESULT_MESSAGE })
    expect(await recordCourtChargePayment(client, club, 'ch-1', payment)).toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith('record_court_charge_payment', expect.objectContaining({ p_charge_id: 'ch-1', p_amount_cents: 500000, p_reference: null }))
    expect(keyOf(rpc, 1)).toBe(keyOf(rpc, 0))
  })
  it('un segundo pago legítimo igual, tras confirmar el primero, usa otra clave', async () => {
    const { client, rpc } = fakeClient([{ data: { id: 'p1' }, error: null }, { data: { id: 'p2' }, error: null }])
    await recordCourtChargePayment(client, club, 'ch-1', payment)
    await recordCourtChargePayment(client, club, 'ch-1', payment)
    expect(keyOf(rpc, 1)).not.toBe(keyOf(rpc, 0))
  })
  it('el sobrepago lo rechaza el servidor y se informa', async () => {
    const { client } = fakeClient([{ data: null, error: { code: '22023', message: 'El importe supera el saldo pendiente del cargo.' } }])
    expect(await recordCourtChargePayment(client, club, 'ch-1', payment)).toEqual({ ok: false, message: 'El importe supera el saldo pendiente del cargo.' })
  })
})

describe('anulaciones', () => {
  it('anular cargo con motivo; el error del servidor se traduce a un mensaje claro', async () => {
    const { client, rpc } = fakeClient([{ data: null, error: null }, { data: null, error: { code: '22023', message: 'El cargo tiene pagos vigentes. Anulá primero los pagos.' } }])
    expect(await voidCourtCharge(client, 'ch-1', ' error ')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('void_court_charge', { p_charge_id: 'ch-1', p_reason: 'error' })
    expect(await voidCourtCharge(client, 'ch-1', 'x')).toEqual({ ok: false, message: 'El cargo tiene pagos vigentes. Anulá primero los pagos.' })
  })
})
