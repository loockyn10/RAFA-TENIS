import type { ReactNode } from 'react'
const crestUrl = '/branding/logoRafa.png'
import { initials } from '../format'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

/** Escudo original del club (apps/web/public/branding/logoRafa.png). */
export function Crest({ size = 40, className }: { size?: number; className?: string }) {
  return <img className={`crest ${className ?? ''}`} src={crestUrl} width={size} height={Math.round(size * 1.14)} alt="Escudo de Rafa Tenis" />
}

const AVATAR_TONES = ['green', 'clay', 'ball', 'deep'] as const
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const tone = AVATAR_TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length]
  return <span className={`avatar avatar-${size} avatar-${tone}`} aria-hidden="true">{initials(name)}</span>
}

export function Stepper({ value, onChange, label, min = 0 }: { value: number; onChange: (value: number) => void; label: string; min?: number }) {
  return (
    <span className="stepper" role="group" aria-label={`Cantidad de ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={value === 1 ? `Quitar ${label}` : `Restar uno de ${label}`}>
        <Icon name={value === 1 ? 'trash' : 'minus'} size={16} />
      </button>
      <output className="num" aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`Sumar uno de ${label}`}><Icon name="plus" size={16} /></button>
    </span>
  )
}

/** Mini cancha de polvo de ladrillo: firma visual de las canchas del club. */
export function CourtMark({ label, size = 'md', tone = 'clay' }: { label: string; size?: 'sm' | 'md' | 'lg'; tone?: 'clay' | 'muted' | 'green' }) {
  return (
    <span className={`court-mark court-mark-${size} court-mark-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 40 52" preserveAspectRatio="none">
        <rect x="4" y="4" width="32" height="44" rx="1" />
        <path d="M9 4v44M31 4v44M4 26h32M9 14h22M9 38h22M20 14v24" />
      </svg>
      <b>{label}</b>
    </span>
  )
}

export function SectionHeader({ title, eyebrow, action, id }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && <p className="kicker">{eyebrow}</p>}
        <h2 id={id} className="section-title">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon = 'ball', title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <span className="state-icon"><Icon name={icon} size={28} /></span>
      <p className="state-title">{title}</p>
      {body && <p className="state-body">{body}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'No pudimos cargar la información', body = 'Revisá la conexión e intentá de nuevo. No se perdió ningún dato.', onRetry }: { title?: string; body?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon"><Icon name="alert" size={28} /></span>
      <p className="state-title">{title}</p>
      <p className="state-body">{body}</p>
      {onRetry && <Button variant="secondary" icon="refresh" onClick={onRetry}>Reintentar</Button>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 16, radius = 8, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={`skeleton ${className ?? ''}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

export function SkeletonCards({ count = 3, height = 88 }: { count?: number; height?: number }) {
  return (
    <div className="skeleton-stack" role="status" aria-label="Cargando">
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} height={height} radius={14} />)}
    </div>
  )
}

/** Encabezado de sección dentro del contenido (el header global ya no muestra títulos). */
export function PageHead({ eyebrow, title, meta, actions }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <p className="kicker">{eyebrow}</p>}
        <h2 className="page-title display">{title}</h2>
        {meta && <p className="page-head-meta">{meta}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  )
}

export type Stat = { id: string; label: string; value: ReactNode; foot?: ReactNode; tone?: 'green' | 'clay' | 'ball' | 'neutral'; selected?: boolean; onClick?: () => void }

/** Indicadores compactos. Si son clicables funcionan como filtros rápidos. En celular se deslizan. */
export function StatStrip({ items, label }: { items: Stat[]; label: string }) {
  return (
    <ul className="stat-strip" aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value display num">{item.value}</strong>
            {item.foot && <span className="stat-foot">{item.foot}</span>}
          </>
        )
        return (
          <li key={item.id} className={`stat stat-${item.tone ?? 'neutral'} ${item.selected ? 'is-selected' : ''}`}>
            {item.onClick ? <button type="button" aria-pressed={item.selected ?? false} onClick={item.onClick}>{body}</button> : <div>{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** Barra de progreso con texto accesible. */
export function Meter({ value, max, label, tone = 'green' }: { value: number; max: number; label: string; tone?: 'green' | 'clay' | 'ball' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <span className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}
