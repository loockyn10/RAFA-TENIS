import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, Field, Icon, Modal, SegmentedTabs, SelectInput, Switch, TextArea, TextInput } from '../../design/ui'
import { useAsyncAction } from '../../design/useAsyncAction'
import { todayInTimezone } from '../reservations/reservationUtils'
import type { AdminClubPost, Club } from '../../types/domain'
import { createPost, newRequestKey, publishPost, removePostImage, updatePost, uploadPostImage, type PublishOutcome, type TournamentOption } from './newsApi'
import { IMAGE_MAX_BYTES, POST_BODY_MAX, POST_LOCATION_MAX, POST_TITLE_MAX, canNotifyPost, draftFromPost, emptyDraft, notifyByDefault, validateDraft, validateImageFile, type DraftErrors, type PostDraft } from './newsUtils'

export type FormResult = { post: AdminClubPost; published: PublishOutcome | null }

type Props = {
  open: boolean
  client: SupabaseClient
  club: Club
  /** null = publicación nueva. */
  post: AdminClubPost | null
  tournaments: TournamentOption[]
  imageUrl?: string
  onClose: () => void
  onDone: (result: FormResult) => void
}

/**
 * Alta y edición de una publicación. Guardar borrador no avisa a nadie. «Publicar» (solo borradores) abre un segundo paso con la
 * casilla de aviso; el aviso lo envía el servidor una única vez aunque se repita el clic.
 */
export function PostFormModal({ open, client, club, post, tournaments, imageUrl, onClose, onDone }: Props) {
  const today = todayInTimezone(club.timezone)
  const [draft, setDraft] = useState<PostDraft>(() => (post ? draftFromPost(post) : emptyDraft()))
  const [saved, setSaved] = useState<AdminClubPost | null>(post)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [step, setStep] = useState<'edit' | 'publish'>('edit')
  const [notify, setNotify] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const requestKey = useRef(newRequestKey())
  const action = useAsyncAction()
  const originalDate = saved?.event_date ?? null

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const isDraftState = saved === null || saved.status === 'draft'
  const shownImage = previewUrl ?? (removeImage ? null : imageUrl ?? null)
  const hasImage = Boolean(file) || (!removeImage && Boolean(draft.imagePath))
  const set = (patch: Partial<PostDraft>) => { setDraft((current) => ({ ...current, ...patch })); setErrors({}) }

  const pickFile = (candidate: File | undefined) => {
    if (!candidate) return
    const problem = validateImageFile(candidate)
    setFileError(problem)
    if (problem) return
    setFile(candidate); setRemoveImage(false)
  }

  /** Valida, sube la imagen nueva (si hay) y crea o actualiza. Devuelve la publicación guardada o null si falló. */
  const persist = async (): Promise<AdminClubPost | null> => {
    const checkPast = saved === null || saved.status === 'draft' || draft.eventDate !== originalDate
    const found = validateDraft(draft, today, checkPast)
    if (Object.keys(found).length > 0) { setErrors(found); setStep('edit'); return null }
    let imagePath = removeImage ? null : draft.imagePath
    const previousPath = saved?.image_path ?? null
    if (file) {
      const upload = await uploadPostImage(client, club.id, file)
      if (!upload.ok) { setFileError(upload.message); setStep('edit'); return null }
      imagePath = upload.data
    }
    const payload = { ...draft, imagePath }
    const result = saved ? await updatePost(client, saved.id, payload) : await createPost(client, club.id, payload, requestKey.current)
    if (!result.ok) {
      if (file && imagePath) void removePostImage(client, imagePath) // la imagen recién subida quedó sin publicación: se descarta
      throw new Error(result.message)
    }
    if (previousPath && previousPath !== imagePath) void removePostImage(client, previousPath)
    setSaved(result.data); setDraft((current) => ({ ...current, imagePath })); setFile(null); setRemoveImage(false)
    return result.data
  }

  const saveOnly = () => void action.run(async () => {
    try {
      const result = await persist()
      if (result) onDone({ post: result, published: null })
      return null
    } catch (error) { return (error as Error).message }
  })

  const publish = () => void action.run(async () => {
    let result: AdminClubPost | null
    try { result = await persist() } catch (error) { setStep('edit'); return (error as Error).message }
    if (!result) return null
    const outcome = await publishPost(client, result.id, notify && canNotifyPost({ kind: draft.kind, is_featured: draft.featured }))
    if (!outcome.ok) return `Se guardó como borrador, pero no pudimos publicarla: ${outcome.message}`
    onDone({ post: { ...result, status: 'published' }, published: outcome.data })
    return null
  })

  const openPublishStep = () => {
    const found = validateDraft(draft, today, true)
    if (Object.keys(found).length > 0) { setErrors(found); return }
    setNotify(notifyByDefault({ kind: draft.kind, is_featured: draft.featured }))
    setStep('publish')
  }

  const canNotify = canNotifyPost({ kind: draft.kind, is_featured: draft.featured })
  const editing = saved !== null
  const title = editing ? 'Editar publicación' : 'Nueva publicación'

  return (
    <Modal open={open} onClose={onClose} title={step === 'publish' ? 'Publicar' : title} eyebrow="Novedades" busy={action.saving} size="lg"
      footer={step === 'publish' ? (
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setStep('edit')} disabled={action.saving}>Volver</Button>
          <Button variant="accent" icon="send" loading={action.saving} onClick={publish} data-autofocus>{notify && canNotify ? 'Publicar y avisar' : 'Publicar'}</Button>
        </div>
      ) : (
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          {isDraftState ? (
            <>
              <Button variant="secondary" icon="note" loading={action.saving} onClick={saveOnly}>Guardar borrador</Button>
              <Button variant="accent" icon="send" onClick={openPublishStep} disabled={action.saving}>Publicar…</Button>
            </>
          ) : <Button variant="primary" icon="check" loading={action.saving} onClick={saveOnly}>Guardar cambios</Button>}
        </div>
      )}>
      {action.failed && action.message && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>{action.message}</span></p>}

      {step === 'publish' ? (
        <div className="nv-publish">
          <p><strong>{draft.title.trim()}</strong> quedará visible para los jugadores del club.</p>
          {canNotify ? (
            <Switch checked={notify} onChange={setNotify} label="Avisar a los jugadores" description="Les llega una notificación en la app (y en el celular si activaron los avisos). Se envía una sola vez." />
          ) : (
            <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Los comunicados solo envían aviso si están destacados. Volvé y marcá «Destacada» si querés avisar.</span></p>
          )}
        </div>
      ) : (
        <form className="nv-form" onSubmit={(event) => event.preventDefault()} noValidate>
          <div className="nv-kind">
            {isDraftState ? (
              <SegmentedTabs<'news' | 'event'> label="Tipo de publicación" value={draft.kind} onChange={(kind) => set({ kind })} stretch
                items={[{ id: 'news', label: 'Noticia', icon: 'news' }, { id: 'event', label: 'Evento', icon: 'calendar' }]} />
            ) : <Badge tone={draft.kind === 'event' ? 'clay' : 'success'} icon={draft.kind === 'event' ? 'calendar' : 'news'}>{draft.kind === 'event' ? 'Evento' : 'Noticia'}</Badge>}
            <p className="field-hint">{draft.kind === 'event' ? 'Actividad con fecha: peña, asado, jornada, torneo, suspensión de actividades…' : 'Comunicado general del club. No lleva fecha.'}</p>
          </div>

          <Field label="Título" error={errors.title}>{(id, describedBy) => <TextInput id={id} aria-describedby={describedBy} value={draft.title} maxLength={POST_TITLE_MAX} onChange={(event) => set({ title: event.target.value })} placeholder={draft.kind === 'event' ? 'Peña de fin de mes' : 'Nuevo horario de la cantina'} autoComplete="off" data-autofocus />}</Field>
          <Field label="Descripción" error={errors.body} hint={`${draft.body.length}/${POST_BODY_MAX} · solo texto`}>{(id, describedBy) => <TextArea id={id} aria-describedby={describedBy} rows={5} value={draft.body} maxLength={POST_BODY_MAX} onChange={(event) => set({ body: event.target.value })} />}</Field>

          {draft.kind === 'event' && (
            <div className="nv-when">
              <Field label="Fecha" error={errors.eventDate}>{(id, describedBy) => <TextInput id={id} aria-describedby={describedBy} type="date" value={draft.eventDate} min={saved && saved.status !== 'draft' ? undefined : today} onChange={(event) => set({ eventDate: event.target.value })} />}</Field>
              <Field label="Hora" optional error={errors.eventTime}>{(id, describedBy) => <TextInput id={id} aria-describedby={describedBy} type="time" value={draft.eventTime} onChange={(event) => set({ eventTime: event.target.value })} />}</Field>
            </div>
          )}
          <Field label="Lugar" optional error={errors.location}>{(id, describedBy) => <TextInput id={id} aria-describedby={describedBy} value={draft.location} maxLength={POST_LOCATION_MAX} onChange={(event) => set({ location: event.target.value })} placeholder="Quincho, cancha 3…" autoComplete="off" />}</Field>

          <Field label="Imagen de portada" optional error={fileError ?? undefined} hint={`JPG, PNG o WebP · hasta ${IMAGE_MAX_BYTES / 1024 / 1024} MB`}>{(id, describedBy) => (
            <div className="nv-image-field">
              {shownImage && <img className="nv-image-preview" src={shownImage} alt="Vista previa de la portada" />}
              {!shownImage && hasImage && <p className="muted">La portada actual se mantiene.</p>}
              <div className="nv-image-actions">
                <label className="btn btn-secondary btn-md nv-file">
                  <Icon name="image" size={18} /><span className="btn-label">{hasImage ? 'Cambiar imagen' : 'Elegir imagen'}</span>
                  <input id={id} aria-describedby={describedBy} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = '' }} />
                </label>
                {hasImage && <Button variant="ghost" icon="trash" onClick={() => { setFile(null); setRemoveImage(true); set({ imagePath: null }) }}>Quitar</Button>}
              </div>
            </div>
          )}</Field>

          <Switch checked={draft.featured} onChange={(featured) => set({ featured })} label="Destacar" description="Se muestra primero en el portal. Las noticias destacadas pueden enviarse como aviso." />

          {tournaments.length > 0 && (
            <Field label="Torneo relacionado" optional hint="Si anunciás el mismo torneo en varias publicaciones, cada jugador recibe un solo aviso.">{(id, describedBy) => (
              <SelectInput id={id} aria-describedby={describedBy} value={draft.tournamentId} onChange={(event) => set({ tournamentId: event.target.value })}>
                <option value="">Sin torneo</option>
                {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
              </SelectInput>
            )}</Field>
          )}
        </form>
      )}
    </Modal>
  )
}
