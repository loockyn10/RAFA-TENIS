/*
 * Componentes con conocimiento del dominio del club, construidos sobre el design system.
 * Candidatos directos a trasladarse a apps/web junto con los componentes de src/components/ui.
 */
import { useState, type CSSProperties } from 'react'
import { PAYMENT_LABEL, TODAY, type Court, type PaymentMethod, type Person } from '../data/mock'
import { usePeople } from '../lib/data'
import { METHODS } from '../lib/payments'
import { useStore } from '../lib/store'
import { Avatar, Badge, Button, Chip, CourtMark, EmptyState, Field, Icon, Modal, TextInput } from './ui'

export function MemberBadge({ person }: { person: Person }) {
  if (!person.active) return <Badge tone="neutral" icon="power">Baja</Badge>
  if (person.membership === 'active') return <Badge tone="success">Socio</Badge>
  if (person.membership === 'inactive') return <Badge tone="neutral">Socio inactivo</Badge>
  return <Badge tone="neutral">No socio</Badge>
}

/** Medio de pago: tarjetas grandes (cobro) o chips (formularios densos). */
export function MethodPicker({ value, onChange, variant = 'grid', autoFocus }: { value: PaymentMethod; onChange: (method: PaymentMethod) => void; variant?: 'grid' | 'chips'; autoFocus?: boolean }) {
  if (variant === 'chips') {
    return <div className="chip-row">{METHODS.map((item) => <Chip key={item.id} icon={item.icon} selected={value === item.id} onClick={() => onChange(item.id)}>{PAYMENT_LABEL[item.id]}</Chip>)}</div>
  }
  return (
    <div className="method-grid" role="radiogroup" aria-label="Medio de pago">
      {METHODS.map((item) => (
        <button key={item.id} type="button" role="radio" aria-checked={value === item.id} className={`method ${value === item.id ? 'is-selected' : ''}`} onClick={() => onChange(item.id)} data-autofocus={(autoFocus && item.id === value) || undefined}>
          <Icon name={item.icon} size={24} />
          <span>{PAYMENT_LABEL[item.id]}</span>
        </button>
      ))}
    </div>
  )
}

/** Selector de cancha con estado libre/ocupada para el horario elegido. */
export function CourtPicker({ courts, value, onChange, isBusy, disableBusy = false }: { courts: Court[]; value: string; onChange: (id: string) => void; isBusy: (courtId: string) => boolean; disableBusy?: boolean }) {
  return (
    <div className="court-picker" role="radiogroup" aria-label="Cancha" style={{ '--n': Math.max(courts.length, 1) } as CSSProperties}>
      {courts.map((item) => {
        const busy = isBusy(item.id)
        return (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === value} disabled={disableBusy && busy} className={`court-option ${item.id === value ? 'is-selected' : ''} ${busy ? 'is-busy' : ''}`} onClick={() => onChange(item.id)} aria-label={`${item.name}, ${busy ? 'ocupada' : 'libre'}`}>
            <CourtMark label={item.short} size="sm" tone={item.id === value ? 'clay' : 'muted'} />
            <span className="court-option-state">{busy ? 'Ocupada' : 'Libre'}</span>
          </button>
        )
      })}
    </div>
  )
}

type PickerProps = {
  open: boolean
  title: string
  hint?: string
  onClose: () => void
  onPick: (id: string) => void
  /** Personas elegibles (por defecto: fichas activas). */
  filter?: (person: Person) => boolean
  /** Si devuelve texto, la persona aparece deshabilitada con ese motivo. */
  disabledReason?: (person: Person) => string | undefined
  /** Permite dar de alta una ficha rápida con el nombre buscado. */
  allowCreate?: boolean
}

/** Buscador de fichas reutilizado por cantina, escuela, torneos, cuotas e invitaciones. */
export function PersonPicker({ open, title, hint, onClose, onPick, filter, disabledReason, allowCreate = false }: PickerProps) {
  const { dispatch } = useStore()
  const { active } = usePeople()
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const pool = active.filter((person) => (filter ? filter(person) : true))
  const people = pool.filter((person) => person.name.toLowerCase().includes(term) || (person.phone ?? '').replace(/\D/g, '').includes(term.replace(/\D/g, '') || '§')).slice(0, 8)
  const exact = pool.some((person) => person.name.toLowerCase() === term)

  const create = () => {
    const name = query.trim().replace(/\s+/g, ' ')
    const id = `p-new-${Date.now()}`
    dispatch({ type: 'person/add', person: { id, name, active: true, membership: 'none', createdOn: TODAY } })
    setQuery('')
    onPick(id)
  }

  return (
    <Modal open={open} onClose={() => { setQuery(''); onClose() }} size="sm" title={title}>
      <div className="picker">
        <Field label="Buscar ficha" hint={hint}>{(id, describedBy) => <TextInput id={id} icon="search" value={query} aria-describedby={describedBy} placeholder="Nombre o teléfono" autoComplete="off" onChange={(event) => setQuery(event.target.value)} data-autofocus />}</Field>
        {people.length === 0 && !(allowCreate && term) ? (
          <EmptyState icon="users" title="Sin coincidencias" body={allowCreate ? 'Escribí el nombre para crear una ficha rápida.' : 'Probá con otro nombre.'} />
        ) : (
          <ul className="picker-list">
            {people.map((person) => {
              const reason = disabledReason?.(person)
              return (
                <li key={person.id}>
                  <button type="button" className="picker-row" disabled={Boolean(reason)} onClick={() => { setQuery(''); onPick(person.id) }}>
                    <Avatar name={person.name} size="sm" />
                    <span>{person.name}{reason && <small className="picker-reason">{reason}</small>}</span>
                    <MemberBadge person={person} />
                  </button>
                </li>
              )
            })}
            {allowCreate && term.length > 1 && !exact && (
              <li>
                <button type="button" className="picker-row picker-create" onClick={create}>
                  <span className="picker-create-icon"><Icon name="userPlus" size={18} /></span>
                  <span>Crear ficha «{query.trim()}»<small className="picker-reason">Alta rápida, sin cuenta ni membresía</small></span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Fila de persona seleccionada con acción para quitarla. */
export function PersonChip({ person, onRemove, meta }: { person: Person; onRemove?: () => void; meta?: string }) {
  return (
    <li className="person-chip">
      <Avatar name={person.name} size="sm" />
      <span className="person-chip-name">{person.name}{meta && <small>{meta}</small>}</span>
      {onRemove && <button type="button" className="person-chip-x" aria-label={`Quitar a ${person.name}`} onClick={onRemove}><Icon name="x" size={16} /></button>}
    </li>
  )
}

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
