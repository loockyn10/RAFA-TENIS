import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Club, CourtCharge, Reservation } from '../../types/domain'
import { releaseOperationKey } from '../../lib/idempotency'
import { PersonAccount } from '../account/PersonAccount'
import { CourtChargeSection } from './CourtChargeSection'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const reservation: Reservation = { id: 'res-1', club_id: 'club-1', court_id: 'c1', customer_name: 'Ana Pérez', person_id: 'p-ana', starts_at: '2026-10-20T21:00:00Z', ends_at: '2026-10-20T22:00:00Z', status: 'confirmed', occupation_type: 'reservation', block_reason: null, recurrence_series_id: null, notes: null, created_by: 'u', created_at: '', updated_at: '' }
// Tarifas de PRUEBA.
const rates = { club_id: 'club-1', rental_hour_cents: 1000000, lighting_hour_cents: 400000, rental_enabled: true, lighting_enabled: true, billing_mode: 'exact', billing_block_minutes: null, updated_at: '', updated_by: 'u' }
const charge: CourtCharge = { id: 'ch-1', club_id: 'club-1', reservation_id: 'res-1', responsible_person_id: 'p-ana', responsible_name_snapshot: 'Ana Pérez', member_status: 'non_member', billable_minutes: 60, rental_applied: true, lighting_applied: false, rental_hour_cents_snapshot: 1000000, lighting_hour_cents_snapshot: null, billing_mode_snapshot: 'exact', billing_block_minutes_snapshot: null, calculated_rental_cents: 1000000, calculated_lighting_cents: null, rental_cents: 1000000, lighting_cents: 0, total_cents: 1000000, adjustment_reason: null, notes: null, status: 'confirmed', client_request_id: 'k', created_at: '', created_by: 'u', voided_at: null, voided_by: null, void_reason: null }

function fakeClient(tables: Record<string, unknown>, rpcResults: Record<string, unknown> = {}) {
  const rpc = vi.fn((name: string) => {
    const result = Promise.resolve(rpcResults[name] ?? { data: null, error: null })
    return Object.assign(result, { abortSignal: () => result })
  })
  const from = vi.fn((table: string) => {
    const data = tables[table] ?? []
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve, reject),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }),
    }
    for (const name of ['select', 'eq', 'in', 'order', 'limit', 'or']) chain[name] = () => chain
    return chain
  })
  return { client: { rpc, from } as never, rpc }
}

beforeEach(() => { window.sessionStorage.clear(); releaseOperationKey('court-charge:club-1:res-1') })

describe('CourtChargeSection (detalle de reserva)', () => {
  it('sin cargo: explica que reservar no cobra, no registra nada solo y ofrece cobrar', async () => {
    const { client, rpc } = fakeClient({ club_court_rate_settings: rates, court_charges: [] })
    render(<CourtChargeSection client={client} club={club} reservation={reservation} courtName="Cancha 1" />)
    expect(await screen.findByRole('button', { name: 'Cobrar cancha o luz' })).toBeInTheDocument()
    expect(screen.getByText(/Reservar no genera un cobro/)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('no ofrece cobrar una reserva cancelada', async () => {
    const { client } = fakeClient({ club_court_rate_settings: rates, court_charges: [] })
    render(<CourtChargeSection client={client} club={club} reservation={{ ...reservation, status: 'cancelled' }} />)
    await screen.findByText(/La reserva está cancelada/)
    expect(screen.queryByRole('button', { name: 'Cobrar cancha o luz' })).not.toBeInTheDocument()
  })

  it('con cargo vigente muestra total, pagado y pendiente, responsable y acciones', async () => {
    const { client } = fakeClient({ club_court_rate_settings: rates, court_charges: [charge], court_charge_payments: [{ id: 'pay-1', club_id: 'club-1', charge_id: 'ch-1', amount_cents: 400000, payment_date: '2026-10-20', payment_method: 'cash', reference: null, notes: null, client_request_id: 'a', created_at: '', created_by: 'u', voided_at: null, voided_by: null, void_reason: null }] })
    render(<CourtChargeSection client={client} club={club} reservation={reservation} />)
    expect(await screen.findByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument()
    expect(screen.getAllByText(/10\.000/).length).toBeGreaterThan(0) // total
    expect(screen.getAllByText(/4\.000/).length).toBeGreaterThan(0) // pagado
    expect(screen.getAllByText(/6\.000/).length).toBeGreaterThan(0) // pendiente
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular cargo' })).not.toBeInTheDocument() // tiene un pago vigente: primero se anula el pago
  })

  it('registrar el cargo: responsable de la reserva, no socio → alquiler sí, iluminación no; envía la confirmación al servidor', async () => {
    const { client, rpc } = fakeClient(
      { club_court_rate_settings: rates, court_charges: [], club_people: { id: 'p-ana', full_name: 'Ana Pérez', active: true }, club_memberships: null },
      { create_court_charge: { data: { ...charge }, error: null } },
    )
    render(<CourtChargeSection client={client} club={club} reservation={reservation} courtName="Cancha 1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cobrar cancha o luz' }))
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('switch', { name: /Alquiler de cancha/ })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByRole('switch', { name: /Iluminación/ })).toHaveAttribute('aria-checked', 'false') // jamás se asume por la hora
    expect(screen.getByText(/Total a cargar/).textContent).toMatch(/10\.000/)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cargo' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_court_charge', expect.objectContaining({ p_club_id: 'club-1', p_reservation_id: 'res-1', p_responsible_person_id: 'p-ana', p_apply_rental: true, p_apply_lighting: false, p_billable_minutes: 60, p_rental_override_cents: null })))
  })

  it('un importe ajustado exige motivo antes de enviar', async () => {
    const { client, rpc } = fakeClient({ club_court_rate_settings: rates, court_charges: [], club_people: { id: 'p-ana', full_name: 'Ana Pérez', active: true }, club_memberships: null })
    render(<CourtChargeSection client={client} club={club} reservation={reservation} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cobrar cancha o luz' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: /Alquiler de cancha/ })).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar importe' }))
    fireEvent.change(screen.getByLabelText(/Alquiler: importe autorizado/), { target: { value: '9.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cargo' }))
    expect(await screen.findByText(/Indicá el motivo del ajuste/)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('PersonAccount (cuenta corriente)', () => {
  const rows = [
    { concept: 'membership_due', source_id: 'd1', occurred_on: '2026-10-01', due_date: '2026-10-10', description: 'Cuota mensual', original_cents: 600000, paid_cents: 200000, balance_cents: 400000, status: 'partial', reservation_id: null },
    { concept: 'canteen', source_id: 's1', occurred_on: '2026-10-12', due_date: null, description: 'Cantina: 2× Agua', original_cents: 300000, paid_cents: 100000, balance_cents: 200000, status: 'partial', reservation_id: null },
    { concept: 'court_lighting', source_id: 'ch1', occurred_on: '2026-10-13', due_date: null, description: 'Cancha 1 · 18:00–19:00 · Iluminación', original_cents: 500000, paid_cents: 150000, balance_cents: 350000, status: 'partial', reservation_id: 'res-1' },
  ]
  it('consolida cuotas, cantina y cancha: total, desglose y acciones por concepto (sin repartir pagos entre módulos)', async () => {
    const { client, rpc } = fakeClient({}, { get_person_account: { data: rows, error: null } })
    const onOpenCanteen = vi.fn()
    render(<PersonAccount client={client} club={club} personId="p-ana" onOpenCanteen={onOpenCanteen} onClose={vi.fn()} />)
    expect(await screen.findByText('Total adeudado')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('get_person_account', { p_club_id: 'club-1', p_person_id: 'p-ana', p_include_settled: false })
    expect(screen.getAllByText(/9\.500/).length).toBeGreaterThan(0) // 4.000 + 2.000 + 3.500
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(3)
    expect(screen.getAllByRole('button', { name: 'Cobrar' })).toHaveLength(2) // cuota y cancha
    fireEvent.click(screen.getByRole('button', { name: 'Ir a Cantina' }))
    expect(onOpenCanteen).toHaveBeenCalled()
  })
  it('sin deuda: «Al día»', async () => {
    const { client } = fakeClient({}, { get_person_account: { data: [], error: null } })
    render(<PersonAccount client={client} club={club} personId="p-ana" />)
    expect(await screen.findByText('Al día')).toBeInTheDocument()
  })
})
