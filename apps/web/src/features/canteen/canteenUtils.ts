import type { CanteenSale, CanteenSaleItem, CanteenSalePayment } from '../../types/domain'

export type CartLine = { productId: string; name: string; unitPriceCents: number; quantity: number }
export type SaleStatus = 'pending' | 'partial' | 'paid' | 'voided'

export function cartTotalCents(lines: CartLine[]) {
  return lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0)
}

export function addToCart(lines: CartLine[], product: Omit<CartLine, 'quantity'>) {
  const existing = lines.find((line) => line.productId === product.productId)
  return existing ? lines.map((line) => line.productId === product.productId ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { ...product, quantity: 1 }]
}

export function changeCartQuantity(lines: CartLine[], productId: string, quantity: number) {
  if (quantity <= 0) return lines.filter((line) => line.productId !== productId)
  return lines.map((line) => line.productId === productId ? { ...line, quantity } : line)
}

export function paidForSale(saleId: string, payments: CanteenSalePayment[]) {
  return payments.filter((payment) => payment.sale_id === saleId).reduce((total, payment) => total + payment.amount_cents, 0)
}

export function balanceForSale(sale: CanteenSale, payments: CanteenSalePayment[]) {
  return sale.status === 'voided' ? 0 : Math.max(0, sale.total_cents - paidForSale(sale.id, payments))
}

export function saleStatus(sale: CanteenSale, payments: CanteenSalePayment[]): SaleStatus {
  if (sale.status === 'voided') return 'voided'
  const paid = paidForSale(sale.id, payments)
  if (paid >= sale.total_cents) return 'paid'
  return paid > 0 ? 'partial' : 'pending'
}

export function saleItemTotal(item: CanteenSaleItem) { return item.quantity * item.unit_price_cents }
