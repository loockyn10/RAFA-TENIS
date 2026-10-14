import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

type FieldShellProps = { label: ReactNode; hint?: ReactNode; error?: ReactNode; optional?: boolean; children: (id: string, describedBy: string | undefined) => ReactNode }

/** Envoltorio de campo: etiqueta visible, ayuda y error asociados por aria-describedby. */
export function Field({ label, hint, error, optional, children }: FieldShellProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <span className="field-optional">opcional</span>}
      </label>
      {children(id, describedBy)}
      {hint && !error && <p className="field-hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errorId}><Icon name="alert" size={14} />{error}</p>}
    </div>
  )
}

export function TextInput({ icon, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon?: IconName }) {
  if (!icon) return <input className="input" {...props} />
  return (
    <span className="input-with-icon">
      <Icon name={icon} size={18} />
      <input className="input" {...props} />
    </span>
  )
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select className="input select" {...props} />
      <Icon name="chevronDown" size={16} />
    </span>
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" rows={3} {...props} />
}

/** Interruptor accesible (role=switch). */
export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {description && <span className="switch-desc">{description}</span>}
      </span>
      <span className={`switch ${checked ? 'is-on' : ''}`} aria-hidden="true"><span /></span>
    </button>
  )
}

/** Importe en pesos: prefijo fijo, teclado numérico y cifras tabulares. */
export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="input-money">
      <span aria-hidden="true">$</span>
      <input className="input num" inputMode="decimal" autoComplete="off" {...props} />
    </span>
  )
}

/** Número pequeño con botones − / + (días, cupos, turnos). */
export function NumberStepper({ value, onChange, min, max, label, unit }: { value: number; onChange: (value: number) => void; min: number; max: number; label: string; unit?: (value: number) => string }) {
  return (
    <span className="num-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Restar uno a ${label}`}><Icon name="minus" size={18} /></button>
      <output className="num" aria-live="polite"><b className="display">{value}</b>{unit && <span>{unit(value)}</span>}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Sumar uno a ${label}`}><Icon name="plus" size={18} /></button>
    </span>
  )
}
