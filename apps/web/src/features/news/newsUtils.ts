import { capitalize, dayNumber, monthLong, weekdayShort } from '../../design/dates'
import type { AdminClubPost, ClubPost, PostKind } from '../../types/domain'

/*
 * Reglas de presentación y validación de Novedades. Son solo ayuda para la persona que escribe: la autoridad final
 * (longitudes, fechas, texto plano, permisos) es PostgreSQL (create_club_post / update_club_post / publish_club_post).
 */

export const POST_TITLE_MIN = 3
export const POST_TITLE_MAX = 140
export const POST_BODY_MAX = 4000
export const POST_LOCATION_MAX = 140
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_BUCKET = 'club-post-images'
/** Tipos de imagen admitidos (el bucket también los exige) y su extensión. SVG queda afuera a propósito: puede contener scripts. */
export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Mismo criterio que el servidor: cualquier cosa con forma de etiqueta HTML (<b>, </p>, <!--, <?xml). «3 < 5» o «<40 años» NO lo es. */
const MARKUP = /<\s*\/?\s*[A-Za-z!?]/
export const containsMarkup = (text: string) => MARKUP.test(text)

export type PostDraft = {
  kind: PostKind
  title: string
  body: string
  eventDate: string
  eventTime: string
  location: string
  featured: boolean
  tournamentId: string
  imagePath: string | null
}

export const emptyDraft = (kind: PostKind = 'news'): PostDraft => ({ kind, title: '', body: '', eventDate: '', eventTime: '', location: '', featured: false, tournamentId: '', imagePath: null })

export const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : '')

export function draftFromPost(post: AdminClubPost): PostDraft {
  return {
    kind: post.kind, title: post.title, body: post.body, eventDate: post.event_date ?? '', eventTime: hhmm(post.event_time),
    location: post.location ?? '', featured: post.is_featured, tournamentId: post.tournament_id ?? '', imagePath: post.image_path,
  }
}

export type DraftErrors = Partial<Record<'title' | 'body' | 'eventDate' | 'eventTime' | 'location', string>>

const isRealDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** `checkPast`: exigir que la fecha no esté en el pasado (al crear o cuando la fecha cambió; no al corregir el texto de un evento ya realizado). */
export function validateDraft(draft: PostDraft, today: string, checkPast: boolean): DraftErrors {
  const errors: DraftErrors = {}
  const title = draft.title.trim()
  const body = draft.body.trim()
  const location = draft.location.trim()
  if (title.length < POST_TITLE_MIN) errors.title = `El título necesita al menos ${POST_TITLE_MIN} caracteres.`
  else if (title.length > POST_TITLE_MAX) errors.title = `El título admite hasta ${POST_TITLE_MAX} caracteres.`
  else if (containsMarkup(title)) errors.title = 'Escribí solo texto: no se admite código HTML.'
  if (body.length === 0) errors.body = 'La descripción es obligatoria.'
  else if (body.length > POST_BODY_MAX) errors.body = `La descripción admite hasta ${POST_BODY_MAX} caracteres.`
  else if (containsMarkup(body)) errors.body = 'Escribí solo texto: no se admite código HTML.'
  if (location.length > POST_LOCATION_MAX) errors.location = `El lugar admite hasta ${POST_LOCATION_MAX} caracteres.`
  else if (containsMarkup(location)) errors.location = 'Escribí solo texto: no se admite código HTML.'
  if (draft.kind === 'event') {
    if (!draft.eventDate) errors.eventDate = 'Indicá la fecha del evento.'
    else if (!isRealDate(draft.eventDate) || draft.eventDate < '2020-01-01' || draft.eventDate > '2100-12-31') errors.eventDate = 'La fecha no es válida.'
    else if (checkPast && draft.eventDate < today) errors.eventDate = 'La fecha del evento no puede estar en el pasado.'
    if (draft.eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.eventTime)) errors.eventTime = 'La hora no es válida.'
  }
  return errors
}

/** Lo que se envía al servidor: un comunicado nunca lleva fecha, hora ni lugar vacío disfrazado. */
export function draftToArgs(draft: PostDraft) {
  const isEvent = draft.kind === 'event'
  return {
    p_kind: draft.kind,
    p_title: draft.title.trim(),
    p_body: draft.body.trim(),
    p_event_date: isEvent ? draft.eventDate : null,
    p_event_time: isEvent && draft.eventTime ? draft.eventTime : null,
    p_location: draft.location.trim() || null,
    p_is_featured: draft.featured,
    p_tournament_id: draft.tournamentId || null,
    p_image_path: draft.imagePath,
  }
}

export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES[file.type]) return 'Elegí una imagen JPG, PNG o WebP.'
  if (file.size > IMAGE_MAX_BYTES) return 'La imagen supera los 2 MB. Elegí una más liviana.'
  if (file.size === 0) return 'La imagen está vacía.'
  return null
}

/** Ruta en el bucket: carpeta del club + nombre aleatorio. Nunca contiene el nombre del archivo original. */
export const imageStoragePath = (clubId: string, file: { type: string }, uuid: string) => `${clubId}/${uuid}.${IMAGE_TYPES[file.type] ?? 'jpg'}`

/** Los comunicados avisan solo si están destacados (regla del servidor); los eventos siempre pueden avisar. */
export const canNotifyPost = (post: Pick<ClubPost, 'kind' | 'is_featured'>) => post.kind === 'event' || post.is_featured
/** Casilla «Avisar a los jugadores» marcada de entrada: eventos y comunicados destacados. */
export const notifyByDefault = canNotifyPost

// ── Fechas ─────────────────────────────────────────────────────────

export const eventTimeLabel = (time: string | null) => (time ? `${hhmm(time)} hs` : 'Horario a confirmar')

export function eventDateParts(date: string) {
  return { day: String(dayNumber(date)), month: monthLong(date).slice(0, 3).toUpperCase(), weekday: capitalize(weekdayShort(date)) }
}

export function eventDateLabel(date: string) {
  return `${capitalize(weekdayShort(date))} ${dayNumber(date)} de ${monthLong(date)}`
}

/** «Hoy», «Mañana», «En 5 días» o «Hace 3 días» respecto del día del club. */
export function relativeEventLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  if (days > 1) return `En ${days} días`
  if (days === -1) return 'Ayer'
  return `Hace ${-days} días`
}

export function publishedLabel(publishedAt: string | null, timezone: string): string {
  if (!publishedAt) return ''
  return new Intl.DateTimeFormat('es-AR', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(publishedAt)).replace('.', '')
}

export const excerpt = (text: string, max = 140) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

// ── Orden del feed ─────────────────────────────────────────────────

const byEventAsc = (a: ClubPost, b: ClubPost) =>
  (a.event_date ?? '').localeCompare(b.event_date ?? '') || (a.event_time ?? '99:99').localeCompare(b.event_time ?? '99:99') || (a.published_at ?? '').localeCompare(b.published_at ?? '')
const byPublishedDesc = (a: ClubPost, b: ClubPost) => (b.published_at ?? '').localeCompare(a.published_at ?? '')

export type FeedGroups = { featured: ClubPost[]; upcoming: ClubPost[]; news: ClubPost[]; past: ClubPost[] }

/**
 * Reparte las publicaciones del club para el portal. «Destacadas» agrupa eventos futuros y comunicados marcados como importantes
 * (un evento ya pasado deja de destacarse); lo destacado no se repite en las otras listas. Próximos eventos por fecha ascendente;
 * comunicados y eventos anteriores del más reciente al más antiguo.
 */
export function splitFeed(posts: ClubPost[], today: string): FeedGroups {
  const isUpcoming = (post: ClubPost) => post.kind === 'event' && (post.event_date ?? '') >= today
  const featured = posts.filter((post) => post.is_featured && (post.kind === 'news' || isUpcoming(post))).sort((a, b) => (isUpcoming(a) && isUpcoming(b) ? byEventAsc(a, b) : byPublishedDesc(a, b)))
  const featuredIds = new Set(featured.map((post) => post.id))
  const rest = posts.filter((post) => !featuredIds.has(post.id))
  return {
    featured,
    upcoming: rest.filter(isUpcoming).sort(byEventAsc),
    news: rest.filter((post) => post.kind === 'news').sort(byPublishedDesc),
    past: rest.filter((post) => post.kind === 'event' && !isUpcoming(post)).sort((a, b) => byEventAsc(b, a)),
  }
}

/** Próximo evento (el más cercano, destacado o no). */
export const nextEvent = (posts: ClubPost[], today: string): ClubPost | null =>
  posts.filter((post) => post.kind === 'event' && (post.event_date ?? '') >= today).sort(byEventAsc)[0] ?? null

// ── Errores ────────────────────────────────────────────────────────

const GENERIC = 'No pudimos completar la operación. Revisá la conexión e intentá de nuevo.'
/** Los mensajes de negocio del servidor (22023, 23503, 42501) ya están en español y se muestran; el resto se reemplaza por un texto genérico. */
export function postErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC
  if (['22023', '23503', '42501'].includes(error.code ?? '') && error.message && error.message.length < 220 && !/^(\w+: |ERROR)/.test(error.message)) return error.message
  return GENERIC
}
