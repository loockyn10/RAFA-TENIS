import type { IconName } from '../components/ui'
import type { PaymentMethod } from '../data/mock'

/** Medios de pago con su ícono (cantina y cuotas). */
export const METHODS: { id: PaymentMethod; icon: IconName }[] = [
  { id: 'cash', icon: 'cash' },
  { id: 'bank_transfer', icon: 'transfer' },
  { id: 'mercado_pago', icon: 'qr' },
  { id: 'other', icon: 'more' },
]
