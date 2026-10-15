import { describe, expect, it } from 'vitest'
import type { AdminClubPost, ClubPost } from '../../types/domain'
import {
  IMAGE_MAX_BYTES, canNotifyPost, containsMarkup, draftFromPost, draftToArgs, emptyDraft, eventTimeLabel, excerpt, imageStoragePath, nextEvent,
  postErrorMessage, relativeEventLabel, splitFeed, validateDraft, validateImageFile,
} from './newsUtils'

const TODAY = '2026-10-15'
const post = (patch: Partial<ClubPost> & { id: string }): ClubPost => ({
  kind: 'news', title: 'Título', body: 'Texto', is_featured: false, event_date: null, event_time: null, location: null, image_path: null, tournament_id: null,
  published_at: '2026-10-01T12:00:00Z', ...patch,
})
const event = (id: string, date: string, time: string | null = null, patch: Partial<ClubPost> = {}) => post({ id, kind: 'event', event_date: date, event_time: time, ...patch })

describe('containsMarkup', () => {
  it('detecta etiquetas HTML y comentarios pero no comparaciones de texto', () => {
    for (const text of ['<script>alert(1)</script>', 'hola <b>mundo</b>', '</p>', '<!-- x -->', '<?xml version?>', '< img src=x>']) expect(containsMarkup(text)).toBe(true)
    for (const text of ['3 < 5', 'menores de <40 años', 'a<3', 'Peña & asado', '5 > 3']) expect(containsMarkup(text)).toBe(false)
  })
})

describe('validateDraft', () => {
  const valid = { ...emptyDraft('news'), title: 'Cierre por lluvia', body: 'Hoy no abrimos.' }

  it('acepta un comunicado válido sin fecha', () => {
    expect(validateDraft(valid, TODAY, true)).toEqual({})
  })

  it('exige título (3–140), descripción y rechaza HTML', () => {
    expect(validateDraft({ ...valid, title: 'ab' }, TODAY, true).title).toMatch(/al menos 3/)
    expect(validateDraft({ ...valid, title: 'x'.repeat(141) }, TODAY, true).title).toMatch(/140/)
    expect(validateDraft({ ...valid, body: '   ' }, TODAY, true).body).toMatch(/obligatoria/)
    expect(validateDraft({ ...valid, body: 'x'.repeat(4001) }, TODAY, true).body).toMatch(/4000/)
    expect(validateDraft({ ...valid, title: 'Hola <script>x</script>' }, TODAY, true).title).toMatch(/HTML/)
    expect(validateDraft({ ...valid, body: '<img src=x onerror=alert(1)>' }, TODAY, true).body).toMatch(/HTML/)
    expect(validateDraft({ ...valid, location: '<b>Quincho</b>' }, TODAY, true).location).toMatch(/HTML/)
  })

  it('un evento exige fecha válida y no pasada (salvo al corregir un evento ya existente)', () => {
    const base = { ...valid, kind: 'event' as const }
    expect(validateDraft(base, TODAY, true).eventDate).toMatch(/Indicá/)
    expect(validateDraft({ ...base, eventDate: '2026-02-30' }, TODAY, true).eventDate).toMatch(/no es válida/)
    expect(validateDraft({ ...base, eventDate: '2019-12-31' }, TODAY, true).eventDate).toMatch(/no es válida/)
    expect(validateDraft({ ...base, eventDate: '2026-10-14' }, TODAY, true).eventDate).toMatch(/pasado/)
    expect(validateDraft({ ...base, eventDate: '2026-10-14' }, TODAY, false)).toEqual({})
    expect(validateDraft({ ...base, eventDate: '2026-10-15' }, TODAY, true)).toEqual({})
  })

  it('la hora es opcional pero debe ser válida', () => {
    const base = { ...valid, kind: 'event' as const, eventDate: '2026-11-01' }
    expect(validateDraft({ ...base, eventTime: '' }, TODAY, true)).toEqual({})
    expect(validateDraft({ ...base, eventTime: '21:00' }, TODAY, true)).toEqual({})
    expect(validateDraft({ ...base, eventTime: '25:00' }, TODAY, true).eventTime).toMatch(/no es válida/)
  })
})

describe('draftToArgs / draftFromPost', () => {
  it('un comunicado nunca envía fecha ni hora aunque el formulario las conserve', () => {
    const args = draftToArgs({ ...emptyDraft('news'), title: ' T ', body: ' B ', eventDate: '2026-11-01', eventTime: '10:00' })
    expect(args).toMatchObject({ p_kind: 'news', p_title: 'T', p_body: 'B', p_event_date: null, p_event_time: null, p_location: null, p_tournament_id: null, p_image_path: null })
  })
  it('un evento envía fecha, hora y lugar', () => {
    const args = draftToArgs({ ...emptyDraft('event'), title: 'Peña', body: 'Asado', eventDate: '2026-11-01', eventTime: '21:00', location: ' Quincho ', featured: true, tournamentId: 't1' })
    expect(args).toMatchObject({ p_kind: 'event', p_event_date: '2026-11-01', p_event_time: '21:00', p_location: 'Quincho', p_is_featured: true, p_tournament_id: 't1' })
  })
  it('recorta los segundos de la hora al editar', () => {
    const admin = { ...event('e1', '2026-11-01', '21:00:00'), club_id: 'c', status: 'draft', archived_at: null, notified_at: null, created_at: '', updated_at: '' } as AdminClubPost
    expect(draftFromPost(admin).eventTime).toBe('21:00')
  })
})

describe('imágenes', () => {
  it('solo admite JPG, PNG y WebP de hasta 2 MB (SVG queda afuera)', () => {
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toBeNull()
    expect(validateImageFile({ type: 'image/jpeg', size: IMAGE_MAX_BYTES })).toBeNull()
    expect(validateImageFile({ type: 'image/svg+xml', size: 1000 })).toMatch(/JPG, PNG o WebP/)
    expect(validateImageFile({ type: 'application/pdf', size: 1000 })).toMatch(/JPG, PNG o WebP/)
    expect(validateImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toMatch(/2 MB/)
    expect(validateImageFile({ type: 'image/png', size: 0 })).toMatch(/vacía/)
  })
  it('la ruta lleva la carpeta del club y un nombre aleatorio, nunca el nombre original', () => {
    expect(imageStoragePath('club-1', { type: 'image/webp' }, 'abc')).toBe('club-1/abc.webp')
  })
})

describe('splitFeed', () => {
  const feed: ClubPost[] = [
    event('late', '2026-12-01', '18:00'),
    event('soon', '2026-10-16', '19:00'),
    event('soon-no-time', '2026-10-16', null),
    event('today', '2026-10-15', '10:00'),
    event('old', '2026-09-01', '10:00'),
    event('older', '2026-08-01', '10:00'),
    post({ id: 'n-old', published_at: '2026-09-01T10:00:00Z' }),
    post({ id: 'n-new', published_at: '2026-10-10T10:00:00Z' }),
    post({ id: 'n-feat', is_featured: true, published_at: '2026-08-01T10:00:00Z' }),
    event('ev-feat', '2026-11-20', '09:00', { is_featured: true }),
    event('ev-feat-past', '2026-07-01', '09:00', { is_featured: true }),
  ]
  const groups = splitFeed(feed, TODAY)

  it('ordena los próximos eventos por fecha y hora ascendente (sin hora al final del día)', () => {
    expect(groups.upcoming.map((item) => item.id)).toEqual(['today', 'soon', 'soon-no-time', 'late'])
  })
  it('comunicados recientes del más nuevo al más viejo', () => {
    expect(groups.news.map((item) => item.id)).toEqual(['n-new', 'n-old'])
  })
  it('destaca comunicados y eventos futuros marcados; no los repite en las otras listas', () => {
    expect(groups.featured.map((item) => item.id).sort()).toEqual(['ev-feat', 'n-feat'])
    expect([...groups.upcoming, ...groups.news, ...groups.past].some((item) => item.is_featured && item.id !== 'ev-feat-past')).toBe(false)
  })
  it('un evento destacado que ya pasó deja de destacarse y va a anteriores, del más reciente al más antiguo', () => {
    expect(groups.past.map((item) => item.id)).toEqual(['old', 'older', 'ev-feat-past'])
  })
  it('nextEvent devuelve el más cercano (hoy incluido)', () => {
    expect(nextEvent(feed, TODAY)?.id).toBe('today')
    expect(nextEvent([post({ id: 'x' })], TODAY)).toBeNull()
  })
})

describe('presentación', () => {
  it('etiquetas relativas', () => {
    expect(relativeEventLabel('2026-10-15', TODAY)).toBe('Hoy')
    expect(relativeEventLabel('2026-10-16', TODAY)).toBe('Mañana')
    expect(relativeEventLabel('2026-10-20', TODAY)).toBe('En 5 días')
    expect(relativeEventLabel('2026-10-14', TODAY)).toBe('Ayer')
    expect(relativeEventLabel('2026-10-10', TODAY)).toBe('Hace 5 días')
  })
  it('horario ausente no se inventa', () => {
    expect(eventTimeLabel(null)).toBe('Horario a confirmar')
    expect(eventTimeLabel('21:00:00')).toBe('21:00 hs')
  })
  it('excerpt compacta espacios y recorta con elipsis', () => {
    expect(excerpt('hola\n\n  mundo')).toBe('hola mundo')
    expect(excerpt('x'.repeat(200), 50)).toHaveLength(50)
  })
  it('solo los comunicados destacados pueden avisar; los eventos siempre', () => {
    expect(canNotifyPost({ kind: 'news', is_featured: false })).toBe(false)
    expect(canNotifyPost({ kind: 'news', is_featured: true })).toBe(true)
    expect(canNotifyPost({ kind: 'event', is_featured: false })).toBe(true)
  })
  it('muestra los mensajes de negocio y oculta el resto', () => {
    expect(postErrorMessage({ code: '22023', message: 'La fecha del evento no puede estar en el pasado.' })).toBe('La fecha del evento no puede estar en el pasado.')
    expect(postErrorMessage({ code: '42501', message: 'No tenés permiso para publicar en este club.' })).toMatch(/permiso/)
    expect(postErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "club_posts_club_request_key"' })).toMatch(/No pudimos completar/)
    expect(postErrorMessage({ code: '22023', message: 'ERROR: algo técnico' })).toMatch(/No pudimos completar/)
    expect(postErrorMessage(null)).toMatch(/No pudimos completar/)
  })
})
