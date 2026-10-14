import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Club } from '../../types/domain'
import { releaseOperationKey } from '../../lib/idempotency'
import { CanteenPanel } from './CanteenPanel'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const category = { id: 'cat-1', club_id: 'club-1', name: 'Bebidas', active: true, created_at: '', updated_at: '' }
const agua = { id: 'prod-agua', club_id: 'club-1', category_id: 'cat-1', name: 'Agua', sale_price_cents: 150000, active: true, created_at: '', updated_at: '' }
const person = { id: 'person-1', club_id: 'club-1', full_name: 'Juan Pérez', phone: null, email: null, notes: null, active: true, created_at: '', updated_at: '' }
const pendingSale = { id: 'sale-1', club_id: 'club-1', customer_person_id: 'person-1', total_cents: 300000, status: 'confirmed', client_request_id: 'req-old', created_at: '2026-10-14T15:00:00Z', created_by: 'u-1', voided_at: null, voided_by: null, void_reason: null }

const networkError = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
const ok = (data: unknown) => ({ data, error: null })

type Setup = { rpcResults?: Record<string, unknown[]>; lookups?: Record<string, unknown>; sales?: unknown[] }
function setup({ rpcResults = {}, lookups = {}, sales = [] }: Setup = {}) {
  const queue: Record<string, unknown[]> = Object.fromEntries(Object.entries(rpcResults).map(([name, list]) => [name, [...list]]))
  const rpc = vi.fn((name: string) => ({ abortSignal: () => Promise.resolve(queue[name]?.shift() ?? ok(null)) }))
  const tables: Record<string, unknown[]> = { canteen_categories: [category], canteen_products: [agua], club_people: [person], canteen_sales: sales, canteen_sale_items: [], canteen_sale_payments: [] }
  const lookupCalls: Array<{ table: string; filters: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.select = () => chain; chain.in = () => chain; chain.order = () => chain; chain.limit = () => chain
    chain.eq = (column: string, value: unknown) => { filters[column] = value; return chain }
    chain.maybeSingle = () => { lookupCalls.push({ table, filters: { ...filters } }); return Promise.resolve({ data: lookups[table] ?? null, error: null }) }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject)
    return chain
  })
  render(<CanteenPanel client={{ rpc, from } as never} club={club} canManageCatalog={false} />)
  return { rpc, lookupCalls }
}
const saleCalls = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.filter((call) => call[0] === 'create_canteen_sale') as unknown as Array<[string, Record<string, unknown>]>
const addAgua = async () => { fireEvent.click(await screen.findByRole('button', { name: /Agua/ })) }
const openCheckout = () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar venta' }))
const confirmButton = () => screen.getByRole('button', { name: /Cobrar y confirmar|Reintentar confirmación|Confirmando/ })

beforeEach(() => { window.sessionStorage.clear(); releaseOperationKey('canteen-sale:club-1'); releaseOperationKey('canteen-payment:club-1:sale-1') })

describe('CanteenPanel · venta idempotente (SEC-05)', () => {
  it('venta normal: envía productos, medio de pago y una clave de operación; vacía el carrito al confirmar', async () => {
    const { rpc } = setup({ rpcResults: { create_canteen_sale: [ok({ id: 's1', status: 'confirmed' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByText('Venta registrada correctamente.')
    expect(saleCalls(rpc)).toHaveLength(1)
    expect(saleCalls(rpc)[0][1]).toEqual(expect.objectContaining({ p_club_id: 'club-1', p_items: [{ product_id: 'prod-agua', quantity: 1 }], p_payment_method: 'cash', p_customer_person_id: null, p_client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }))
    expect(screen.getByText('Tocá un producto para agregarlo.')).toBeInTheDocument()
  })

  it('doble clic al confirmar: una sola operación en vuelo', async () => {
    let finish: (value: unknown) => void = () => undefined
    const rpc = vi.fn(() => ({ abortSignal: () => new Promise((resolve) => { finish = resolve }) }))
    const tables: Record<string, unknown[]> = { canteen_categories: [category], canteen_products: [agua], club_people: [person], canteen_sales: [], canteen_sale_items: [], canteen_sale_payments: [] }
    const from = (table: string) => { const chain: Record<string, unknown> = {}; for (const name of ['select', 'in', 'order', 'limit', 'eq']) chain[name] = () => chain; chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve); return chain }
    render(<CanteenPanel client={{ rpc, from } as never} club={club} canManageCatalog={false} />)
    await addAgua(); openCheckout()
    const button = confirmButton()
    act(() => { button.click(); button.click(); button.click() })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeDisabled()
    await act(async () => { finish(ok({ id: 's1', status: 'confirmed' })) })
    await screen.findByText('Venta registrada correctamente.')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('respuesta perdida: conserva el carrito, avisa, y el reintento reutiliza la MISMA clave', async () => {
    const { rpc } = setup({ rpcResults: { create_canteen_sale: [networkError, ok({ id: 's1', status: 'confirmed' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos confirmar si la operación se registró')
    expect(screen.getByRole('dialog', { name: 'Confirmar venta' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación' }))
    await screen.findByText('Venta registrada correctamente.')
    const [first, second] = saleCalls(rpc)
    expect(second[1].p_client_request_id).toBe(first[1].p_client_request_id)
    expect(second[1].p_items).toEqual(first[1].p_items)
    expect(screen.getByText('Tocá un producto para agregarlo.')).toBeInTheDocument()
  })

  it('respuesta perdida pero la venta SÍ se confirmó: la recupera por su clave y no vuelve a enviarla', async () => {
    const { rpc, lookupCalls } = setup({ rpcResults: { create_canteen_sale: [networkError] }, lookups: { canteen_sales: { ...pendingSale, status: 'confirmed' } } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByText('La venta ya estaba registrada: la recuperamos sin duplicarla.')
    expect(saleCalls(rpc)).toHaveLength(1)
    const lookup = lookupCalls.find((call) => call.table === 'canteen_sales')
    expect(lookup?.filters).toEqual({ club_id: 'club-1', client_request_id: saleCalls(rpc)[0][1].p_client_request_id })
    expect(screen.getByText('Tocá un producto para agregarlo.')).toBeInTheDocument()
  })

  it('una venta nueva después de confirmar la anterior usa una clave nueva (aunque tenga los mismos productos)', async () => {
    const { rpc } = setup({ rpcResults: { create_canteen_sale: [ok({ id: 's1', status: 'confirmed' }), ok({ id: 's2', status: 'confirmed' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByText('Venta registrada correctamente.')
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await waitFor(() => expect(saleCalls(rpc)).toHaveLength(2))
    expect(saleCalls(rpc)[1][1].p_client_request_id).not.toBe(saleCalls(rpc)[0][1].p_client_request_id)
  })

  it('si tras un error incierto el usuario cambia el carrito, es otra venta: clave nueva', async () => {
    const { rpc } = setup({ rpcResults: { create_canteen_sale: [networkError, ok({ id: 's2', status: 'confirmed' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar una unidad de Agua' }))
    openCheckout(); fireEvent.click(confirmButton())
    await waitFor(() => expect(saleCalls(rpc)).toHaveLength(2))
    expect(saleCalls(rpc)[1][1].p_client_request_id).not.toBe(saleCalls(rpc)[0][1].p_client_request_id)
    expect(saleCalls(rpc)[1][1].p_items).toEqual([{ product_id: 'prod-agua', quantity: 2 }])
  })

  it('«Vaciar» tras un error incierto es la decisión de empezar una venta nueva: libera la clave', async () => {
    const { rpc } = setup({ rpcResults: { create_canteen_sale: [networkError, ok({ id: 's2', status: 'confirmed' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vaciar' }))
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await waitFor(() => expect(saleCalls(rpc)).toHaveLength(2))
    expect(saleCalls(rpc)[1][1].p_client_request_id).not.toBe(saleCalls(rpc)[0][1].p_client_request_id)
  })

  it('rechazo del servidor: muestra el motivo dentro del diálogo y conserva el carrito', async () => {
    setup({ rpcResults: { create_canteen_sale: [{ data: null, error: { code: '23503', message: 'Uno de los productos no está disponible en este club.' } }] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Uno de los productos no está disponible en este club.')
    expect(within(screen.getByRole('dialog', { name: 'Confirmar venta' })).getByRole('alert')).toBe(alert)
    expect(screen.queryByText('Tocá un producto para agregarlo.')).not.toBeInTheDocument()
  })

  it('clave reutilizada con otros datos (23505): avisa y no pierde el carrito', async () => {
    setup({ rpcResults: { create_canteen_sale: [{ data: null, error: { code: '23505', message: 'x' } }] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('ya había sido registrada con otros datos')
    expect(screen.getByRole('dialog', { name: 'Confirmar venta' })).toBeInTheDocument()
  })

  it('si la venta recuperada fue anulada después, lo informa en lugar de decir que se registró', async () => {
    setup({ rpcResults: { create_canteen_sale: [ok({ id: 's1', status: 'voided' })] } })
    await addAgua(); openCheckout(); fireEvent.click(confirmButton())
    await screen.findByText('Esta venta ya se había registrado y luego fue anulada. No se registró otra.')
  })
})

describe('CanteenPanel · pago de consumo pendiente idempotente (SEC-05)', () => {
  const openPaymentDialog = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Consumos pendientes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar pago' }))
    return screen.getByRole('dialog', { name: 'Registrar pago de consumo' })
  }
  const paymentCalls = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.filter((call) => call[0] === 'record_canteen_sale_payment') as unknown as Array<[string, Record<string, unknown>]>

  it('pago normal con clave de operación', async () => {
    const { rpc } = setup({ sales: [pendingSale], rpcResults: { record_canteen_sale_payment: [ok({ id: 'pay-1' })] } })
    const dialog = await openPaymentDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    await screen.findByText('Pago registrado.')
    expect(paymentCalls(rpc)[0][1]).toEqual(expect.objectContaining({ p_club_id: 'club-1', p_sale_id: 'sale-1', p_amount_cents: 300000, p_payment_method: 'cash', p_client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }))
  })

  it('doble clic: un solo envío', async () => {
    const { rpc } = setup({ sales: [pendingSale], rpcResults: { record_canteen_sale_payment: [ok({ id: 'pay-1' })] } })
    const dialog = await openPaymentDialog()
    const button = within(dialog).getByRole('button', { name: 'Registrar pago' })
    act(() => { button.click(); button.click() })
    await screen.findByText('Pago registrado.')
    expect(paymentCalls(rpc)).toHaveLength(1)
  })

  it('respuesta perdida: el reintento usa la misma clave y el mismo importe', async () => {
    const { rpc } = setup({ sales: [pendingSale], rpcResults: { record_canteen_sale_payment: [networkError, ok({ id: 'pay-1' })] } })
    const dialog = await openPaymentDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No pudimos confirmar si la operación se registró')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar pago' }))
    await screen.findByText('Pago registrado.')
    const [first, second] = paymentCalls(rpc)
    expect(second[1].p_client_request_id).toBe(first[1].p_client_request_id)
    expect(second[1].p_amount_cents).toBe(first[1].p_amount_cents)
  })

  it('el pago ya estaba registrado: lo recupera por su clave', async () => {
    const { rpc, lookupCalls } = setup({ sales: [pendingSale], rpcResults: { record_canteen_sale_payment: [networkError] }, lookups: { canteen_sale_payments: { id: 'pay-1', sale_id: 'sale-1' } } })
    const dialog = await openPaymentDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    await screen.findByText('El pago ya estaba registrado: lo recuperamos sin duplicarlo.')
    expect(paymentCalls(rpc)).toHaveLength(1)
    expect(lookupCalls.some((call) => call.table === 'canteen_sale_payments' && call.filters.club_id === 'club-1')).toBe(true)
  })

  it('sobrepago rechazado por el servidor: mensaje dentro del diálogo, sin cerrar', async () => {
    setup({ sales: [pendingSale], rpcResults: { record_canteen_sale_payment: [{ data: null, error: { code: '22023', message: 'El importe supera el saldo pendiente de la venta.' } }] } })
    const dialog = await openPaymentDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('El importe supera el saldo pendiente de la venta.')
  })
})
