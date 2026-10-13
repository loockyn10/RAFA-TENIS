import { describe, expect, it } from 'vitest'
import type { CanteenSale, CanteenSalePayment } from '../../types/domain'
import { addToCart, balanceForSale, cartTotalCents, changeCartQuantity, saleStatus } from './canteenUtils'

const sale: CanteenSale = { id: 'sale-1', club_id: 'club-1', customer_person_id: 'person-1', total_cents: 550000, status: 'confirmed', client_request_id: 'request-1', created_at: '', created_by: 'user-1', voided_at: null, voided_by: null, void_reason: null }
const payment = (amount_cents: number): CanteenSalePayment => ({ id: crypto.randomUUID(), club_id: 'club-1', sale_id: 'sale-1', amount_cents, payment_date: '2026-10-13', payment_method: 'cash', reference: null, notes: null, created_at: '', created_by: 'user-1' })

describe('canteen utilities', () => {
  it('agrega, incrementa, disminuye y elimina líneas del carrito', () => {
    const product = { productId: 'beer', name: 'Cerveza', unitPriceCents: 300000 }
    const twice = addToCart(addToCart([], product), product)
    expect(twice).toEqual([{ ...product, quantity: 2 }])
    expect(changeCartQuantity(twice, 'beer', 1)).toEqual([{ ...product, quantity: 1 }])
    expect(changeCartQuantity(twice, 'beer', 0)).toEqual([])
  })
  it('calcula el total a partir del precio histórico de cada línea', () => {
    expect(cartTotalCents([{ productId: 'beer', name: 'Cerveza', unitPriceCents: 300000, quantity: 1 }, { productId: 'powerade', name: 'Powerade', unitPriceCents: 250000, quantity: 1 }])).toBe(550000)
  })
  it('distingue saldo pendiente, parcial, pagado y venta anulada', () => {
    expect(balanceForSale(sale, [])).toBe(550000)
    expect(saleStatus(sale, [])).toBe('pending')
    expect(balanceForSale(sale, [payment(200000)])).toBe(350000)
    expect(saleStatus(sale, [payment(200000)])).toBe('partial')
    expect(saleStatus(sale, [payment(550000)])).toBe('paid')
    expect(saleStatus({ ...sale, status: 'voided' }, [])).toBe('voided')
  })
})
