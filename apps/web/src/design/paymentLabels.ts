import type { PaymentMethod } from '../types/domain'

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'Efectivo', bank_transfer: 'Transferencia', mercado_pago: 'Mercado Pago', other: 'Otro' }
