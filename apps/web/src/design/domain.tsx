/*
 * Componentes con conocimiento del dominio del club construidos sobre el design system.
 * Solo presentación: no contienen reglas de negocio ni consultas.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { PaymentMethod } from '../types/domain'
import { Avatar, Badge, Button, Chip, CourtMark, EmptyState, Field, Icon, Modal, TextInput, type IconName } from './ui'
import { PAYMENT_LABELS } from './paymentLabels'
import { normalizeSearch } from './format'

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

export type PickerItem = { id: string; name: string; hint?: string; badge?: ReactNode; disabledReason?: string }

/**
 * Buscador de fichas reutilizado por cuotas, escuela y torneos. Presentacional: quien lo usa decide de dónde salen
 * los resultados (lista local o consulta) y qué hace `onCreate` (alta rápida real, sin cuenta ni membresía).
 */
export function PersonPicker({ open, title, hint, items, query, onQueryChange, onPick, onCreate, onClose, loading = false, busy = false, error, emptyBody }: {
  open: boolean; title: string; hint?: string; items: PickerItem[]; query: string; onQueryChange: (value: string) => void
  onPick: (id: string) => void; onCreate?: (name: string) => void; onClose: () => void; loading?: boolean; busy?: boolean; error?: string | null; emptyBody?: string
}) {
  const term = query.trim()
  const exact = items.some((item) => normalizeSearch(item.name) === normalizeSearch(term))
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title} busy={busy}>
      <div className="picker">
        <Field label="Buscar ficha" hint={hint}>{(id, describedBy) => <TextInput id={id} icon="search" value={query} aria-describedby={describedBy} placeholder="Nombre o teléfono" autoComplete="off" onChange={(event) => onQueryChange(event.target.value)} data-autofocus />}</Field>
        {error && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>{error}</span></p>}
        {items.length === 0 && !(onCreate && term.length > 1) ? (
          <EmptyState icon="users" title={loading ? 'Buscando…' : 'Sin coincidencias'} body={loading ? undefined : emptyBody ?? (onCreate ? 'Escribí el nombre para crear una ficha rápida.' : 'Probá con otro nombre.')} />
        ) : (
          <ul className="picker-list">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className="picker-row" disabled={Boolean(item.disabledReason) || busy} onClick={() => onPick(item.id)}>
                  <Avatar name={item.name} size="sm" />
                  <span>{item.name}{(item.disabledReason ?? item.hint) && <small className="picker-reason">{item.disabledReason ?? item.hint}</small>}</span>
                  {item.badge}
                </button>
              </li>
            ))}
            {onCreate && term.length > 1 && !exact && (
              <li>
                <button type="button" className="picker-row picker-create" disabled={busy} onClick={() => onCreate(term.replace(/\s+/g, ' '))}>
                  <span className="picker-create-icon"><Icon name="userPlus" size={18} /></span>
                  <span>Crear ficha «{term}»<small className="picker-reason">Alta rápida, sin cuenta ni membresía</small></span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Fila de persona elegida con acción para quitarla. */
export function PersonChip({ name, onRemove, meta }: { name: string; onRemove?: () => void; meta?: string }) {
  return (
    <li className="person-chip">
      <Avatar name={name} size="sm" />
      <span className="person-chip-name">{name}{meta && <small>{meta}</small>}</span>
      {onRemove && <button type="button" className="person-chip-x" aria-label={`Quitar a ${name}`} onClick={onRemove}><Icon name="x" size={16} /></button>}
    </li>
  )
}

/** Condición de socio de una ficha real (la baja lógica manda sobre la membresía). */
export function MemberBadge({ active, membership }: { active: boolean; membership?: 'active' | 'inactive' }) {
  if (!active) return <Badge tone="neutral" icon="power">Baja</Badge>
  if (membership === 'active') return <Badge tone="success">Socio</Badge>
  if (membership === 'inactive') return <Badge tone="neutral">Socio inactivo</Badge>
  return <Badge tone="neutral">No socio</Badge>
}

/** Barra fija de guardado para formularios con cambios pendientes (aparece solo si hay algo para guardar). */
export function SaveBar({ visible, saving, failed, onDiscard, onSave, label = 'Cambios sin guardar' }: { visible: boolean; saving: boolean; failed: boolean; onDiscard: () => void; onSave: () => void; label?: string }) {
  if (!visible) return null
  return (
    <div className="save-bar" role="region" aria-label="Guardar cambios">
      <span className="save-bar-text"><Icon name={failed ? 'alert' : 'edit'} size={18} />{failed ? 'No se guardó. Reintentá.' : label}</span>
      <Button variant="ghost" onClick={onDiscard} disabled={saving} className="save-bar-discard">Descartar</Button>
      <Button variant="accent" icon={failed ? 'refresh' : 'check'} loading={saving} onClick={onSave}>{failed ? 'Reintentar' : 'Guardar'}</Button>
    </div>
  )
}
