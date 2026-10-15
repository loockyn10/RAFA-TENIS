import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'clay' | 'dark'

/** Etiqueta de estado. Siempre lleva texto: el color nunca es la única señal. */
export function Badge({ tone = 'neutral', icon, dot = false, children }: { tone?: Tone; icon?: IconName; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: IconName; count?: number; children: ReactNode }

/** Filtro o elección rápida. Usa aria-pressed para lectores de pantalla. */
export function Chip({ selected = false, icon, count, children, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} className={`chip ${selected ? 'is-selected' : ''} ${className ?? ''}`} aria-pressed={selected} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
      {count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  )
}
