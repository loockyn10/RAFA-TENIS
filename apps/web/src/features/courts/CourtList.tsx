import { useState, type FormEvent } from 'react'
import type { Court } from '../../types/domain'

export type CourtPatch = Pick<Court, 'name' | 'surface' | 'active' | 'display_order'>

type CourtListProps = {
  courts: Court[]
  canManage: boolean
  onSave: (court: Court, patch: CourtPatch) => Promise<{ error?: string }>
}

function CourtCard({ court, canManage, onSave }: { court: Court; canManage: boolean; onSave: CourtListProps['onSave'] }) {
  const [name, setName] = useState(court.name)
  const [surface, setSurface] = useState(court.surface)
  const [active, setActive] = useState(court.active)
  const [displayOrder, setDisplayOrder] = useState(court.display_order)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    setFeedback(null)
    const result = await onSave(court, { name: name.trim(), surface: surface.trim(), active, display_order: displayOrder })
    setFeedback(result.error ?? 'Cambios guardados.')
    setIsSaving(false)
  }

  if (!canManage) {
    return (
      <article className="court-card">
        <div className="court-card-header"><h3>{court.name}</h3><CourtState active={court.active} /></div>
        <dl><div><dt>Superficie</dt><dd>{court.surface}</dd></div><div><dt>Orden</dt><dd>{court.display_order}</dd></div></dl>
      </article>
    )
  }

  return (
    <article className="court-card">
      <form onSubmit={save}>
        <div className="court-card-header"><h3>{court.name}</h3><CourtState active={active} /></div>
        <div className="court-fields">
          <label>Nombre<input aria-label={`Nombre de ${court.name}`} value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Superficie<input aria-label={`Superficie de ${court.name}`} value={surface} onChange={(event) => setSurface(event.target.value)} required /></label>
          <label>Orden<input aria-label={`Orden de ${court.name}`} type="number" min="1" value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} required /></label>
          <label className="toggle-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Activa</label>
        </div>
        {feedback && <p className={feedback === 'Cambios guardados.' ? 'form-success' : 'form-error'} role="status">{feedback}</p>}
        <button type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : 'Guardar cancha'}</button>
      </form>
    </article>
  )
}

function CourtState({ active }: { active: boolean }) {
  return <span className={active ? 'court-state active' : 'court-state'}>{active ? 'Activa' : 'Inactiva'}</span>
}

export function CourtList({ courts, canManage, onSave }: CourtListProps) {
  const orderedCourts = [...courts].sort((first, second) => first.display_order - second.display_order || first.name.localeCompare(second.name, 'es'))

  return (
    <section aria-labelledby="courts-title">
      <div className="section-heading"><div><p className="eyebrow">Configuración</p><h2 id="courts-title">Canchas</h2></div><p>{canManage ? 'Podés actualizar la configuración de cada cancha.' : 'Tu rol permite consultar la configuración.'}</p></div>
      <div className="court-grid">{orderedCourts.map((court) => <CourtCard key={court.id} court={court} canManage={canManage} onSave={onSave} />)}</div>
    </section>
  )
}
