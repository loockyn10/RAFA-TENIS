/*
 * Componentes con conocimiento del dominio del club construidos sobre el design system.
 * Solo presentación: no contienen reglas de negocio ni consultas.
 */
import type { CSSProperties } from 'react'
import type { PaymentMethod } from '../types/domain'
import { Chip, CourtMark, Icon, type IconName } from './ui'
import { PAYMENT_LABELS } from './paymentLabels'

const METHODS: { id: PaymentMethod; icon: IconName }[] = [
  { id: 'cash', icon: 'cash' },
  { id: 'bank_transfer', icon: 'transfer' },
  { id: 'mercado_pago', icon: 'qr' },
  { id: 'other', icon: 'more' },
]

/** Medio de pago: tarjetas grandes (cobro) o chips (formularios densos). */
export function MethodPicker({ value, onChange, variant = 'grid', label = 'Medio de pago' }: { value: PaymentMethod; onChange: (method: PaymentMethod) => void; variant?: 'grid' | 'chips'; label?: string }) {
  if (variant === 'chips') {
    return <div className="chip-row" role="radiogroup" aria-label={label}>{METHODS.map((item) => <Chip key={item.id} icon={item.icon} selected={value === item.id} onClick={() => onChange(item.id)}>{PAYMENT_LABELS[item.id]}</Chip>)}</div>
  }
  return (
    <div className="method-grid" role="radiogroup" aria-label={label}>
      {METHODS.map((item) => (
        <button key={item.id} type="button" role="radio" aria-checked={value === item.id} className={`method ${value === item.id ? 'is-selected' : ''}`} onClick={() => onChange(item.id)}>
          <Icon name={item.icon} size={24} />
          <span>{PAYMENT_LABELS[item.id]}</span>
        </button>
      ))}
    </div>
  )
}

/** Selector de cancha. `isBusy` devuelve undefined cuando no hay información de ocupación para el horario elegido. */
export function CourtPicker({ courts, value, onChange, isBusy, short }: { courts: { id: string; name: string }[]; value: string; onChange: (id: string) => void; isBusy?: (courtId: string) => boolean | undefined; short: (court: { id: string; name: string }) => string }) {
  return (
    <div className="court-picker" role="radiogroup" aria-label="Cancha" style={{ '--n': Math.max(courts.length, 1) } as CSSProperties}>
      {courts.map((item) => {
        const busy = isBusy?.(item.id)
        return (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === value} className={`court-option ${item.id === value ? 'is-selected' : ''} ${busy ? 'is-busy' : ''}`} onClick={() => onChange(item.id)} aria-label={busy === undefined ? item.name : `${item.name}, ${busy ? 'ocupada' : 'libre'}`}>
            <CourtMark label={short(item)} size="sm" tone={item.id === value ? 'clay' : 'muted'} />
            <span className="court-option-state">{busy === undefined ? item.name : busy ? 'Ocupada' : 'Libre'}</span>
          </button>
        )
      })}
    </div>
  )
}
