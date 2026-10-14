/*
 * Datos 100 % ficticios para el prototipo. No representan personas, tarifas ni políticas reales del club.
 * Las formas imitan el dominio de apps/web (canchas, ocupaciones, fichas, cuotas, escuela, torneos, cantina, portal)
 * para facilitar la integración. Todo lo editable vive en el store (src/lib/store.ts); acá solo están las semillas.
 */
import { generateFixture, recordResult, type Entry, type Match } from '../lib/tournament'
import { addDays, toISO, type Minutes } from '../lib/time'

export const TODAY = toISO(new Date())
/** Hora simulada para que la demo sea estable: tarde con el club en movimiento. */
export const NOW: Minutes = 18 * 60 + 20

export type Club = { name: string; city: string; phone: string; timezone: string }
export const CLUB: Club = { name: 'Rafa Tenis', city: 'Esperanza, Santa Fe', phone: '3496 40-0000', timezone: 'America/Argentina/Buenos_Aires' }

// ── Canchas ─────────────────────────────────────────────────────────
export const SURFACES = ['Polvo de ladrillo', 'Cemento', 'Césped sintético', 'Carpeta'] as const
export type Court = { id: string; name: string; short: string; surface: string; active: boolean; order: number }
export const COURTS: Court[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `c${n}`,
  name: `Cancha ${n}`,
  short: String(n),
  surface: 'Polvo de ladrillo',
  active: true,
  order: n,
}))

/** Rótulo corto para la marca de cancha: el número del nombre o sus iniciales. */
export function courtShort(name: string): string {
  const number = name.match(/\d+/)?.[0]
  if (number) return number.slice(0, 2)
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || '·'
}

// ── Personas (fichas, con o sin cuenta) ─────────────────────────────
/** none = no socio. La membresía es independiente de la ficha y de la cuenta (D010). */
export type Membership = 'active' | 'inactive' | 'none'
export type Person = {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
  /** Baja lógica de la ficha: no se borra, deja de aparecer en búsquedas operativas. */
  active: boolean
  membership: Membership
  memberSince?: string
  /** Perfil de profesor de la escuela (active/inactive). No concede acceso administrativo. */
  coach?: 'active' | 'inactive'
  hasAccount?: boolean
  createdOn: string
}

const p = (id: string, name: string, membership: Membership, extra: Partial<Person> = {}): Person => ({ id, name, membership, active: true, createdOn: addDays(TODAY, -400), memberSince: membership === 'none' ? undefined : '2023-03-01', ...extra })

export const PEOPLE: Person[] = [
  p('p1', 'Martina Gómez', 'active', { phone: '3496 41-2290', email: 'martina.gomez@correo.test', hasAccount: true, memberSince: '2021-04-01' }),
  p('p2', 'Lucas Benítez', 'active', { phone: '3496 50-1187' }),
  p('p3', 'Sofía Ramírez', 'active', { memberSince: '2024-02-01' }),
  p('p4', 'Joaquín Peralta', 'active', { phone: '3496 47-3302', email: 'joaquin.peralta@correo.test', hasAccount: true }),
  p('p5', 'Valentina Ríos', 'none'),
  p('p6', 'Tomás Acosta', 'active'),
  p('p7', 'Camila Herrera', 'active', { phone: '3496 44-9021' }),
  p('p8', 'Nicolás Suárez', 'none', { phone: '342 515-0098', notes: 'Visitante de Santa Fe. Juega los martes.' }),
  p('p9', 'Julieta Molina', 'active'),
  p('p10', 'Franco Aguirre', 'active', { phone: '3496 52-7710' }),
  p('p11', 'Agustina Sosa', 'active', { email: 'agus.sosa@correo.test' }),
  p('p12', 'Mateo Romero', 'active'),
  p('p13', 'Ignacio Vera', 'none'),
  p('p14', 'Federico Paz', 'active', { memberSince: '2025-08-01' }),
  p('p15', 'Diego Ledesma', 'active', { coach: 'active', phone: '3496 45-1020' }),
  p('p16', 'Lucía Ferreyra', 'active', { coach: 'active', phone: '3496 43-8890' }),
  p('p17', 'Bruno Medina', 'active', { memberSince: '2026-01-01' }),
  p('p18', 'Paula Giménez', 'inactive', { notes: 'Pausó la membresía por viaje.' }),
  p('p19', 'Emilia Castro', 'active', { notes: 'Menor. Contacto: madre, 3496 46-1122.' }),
  p('p20', 'Santiago Ortiz', 'none', { phone: '3496 55-0043' }),
  p('p21', 'Rocío Benítez', 'active'),
  p('p22', 'Gabriel Torres', 'inactive', { active: false, notes: 'Se mudó de ciudad.' }),
  p('p23', 'Ramiro Quiroga', 'none', { coach: 'inactive', notes: 'Profesor invitado en verano.' }),
]

export const isMember = (person?: Person) => person?.membership === 'active'

// ── Ocupaciones: una sola agenda para reservas, bloqueos, clases y partidos ──
export type OccKind = 'reservation' | 'block' | 'lesson' | 'match'
export const BLOCK_REASONS = ['Lluvia', 'Mantenimiento', 'Evento', 'Uso interno', 'Otro motivo'] as const
export type BlockReason = (typeof BLOCK_REASONS)[number]
export type MatchRef = { tournamentId: string; categoryId: string; matchId: string }

export type Occupation = {
  id: string
  courtId: string
  date: string
  start: Minutes
  end: Minutes
  kind: OccKind
  title: string
  personId?: string
  series?: boolean
  seriesId?: string
  note?: string
  reason?: BlockReason
  /** Clases: nombre del profesor (snapshot), ficha, tipo, cupo y alumnos. */
  coach?: string
  coachId?: string
  lessonType?: 'individual' | 'group'
  students?: number
  studentIds?: string[]
  capacity?: number
  /** Partidos: vínculo con el fixture. */
  matchRef?: MatchRef
}

export const KIND_LABEL: Record<OccKind, string> = {
  reservation: 'Reserva',
  block: 'Bloqueo',
  lesson: 'Clase',
  match: 'Torneo',
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes

const todayOccupations: Omit<Occupation, 'id' | 'date'>[] = [
  { courtId: 'c1', start: h(10), end: h(11), kind: 'reservation', title: 'Joaquín Peralta', personId: 'p4' },
  { courtId: 'c1', start: h(17, 30), end: h(19), kind: 'reservation', title: 'Martina Gómez', personId: 'p1' },
  { courtId: 'c1', start: h(19), end: h(20), kind: 'reservation', title: 'Lucas Benítez', personId: 'p2', series: true },
  { courtId: 'c1', start: h(20, 30), end: h(22), kind: 'reservation', title: 'Nicolás Suárez', personId: 'p8', note: 'Trae pelotas nuevas' },
  { courtId: 'c2', start: h(9), end: h(10, 30), kind: 'reservation', title: 'Agustina Sosa', personId: 'p11' },
  { courtId: 'c2', start: h(21), end: h(22, 30), kind: 'reservation', title: 'Franco Aguirre', personId: 'p10' },
  { courtId: 'c3', start: h(7, 30), end: h(9), kind: 'reservation', title: 'Tomás Acosta', personId: 'p6' },
  { courtId: 'c3', start: h(19, 30), end: h(21), kind: 'reservation', title: 'Valentina Ríos', personId: 'p5' },
  { courtId: 'c4', start: h(18, 30), end: h(20), kind: 'reservation', title: 'Julieta Molina', personId: 'p9' },
  { courtId: 'c4', start: h(20), end: h(21, 30), kind: 'reservation', title: 'Mateo Romero', personId: 'p12' },
  { courtId: 'c5', start: h(7), end: h(12), kind: 'block', title: 'Mantenimiento', reason: 'Mantenimiento', note: 'Pasada de rastra y riego' },
  { courtId: 'c5', start: h(19), end: h(20, 30), kind: 'reservation', title: 'Sofía Ramírez', personId: 'p3' },
  { courtId: 'c6', start: h(17), end: h(18, 30), kind: 'reservation', title: 'Ignacio Vera', personId: 'p13' },
  { courtId: 'c6', start: h(21, 30), end: h(23), kind: 'reservation', title: 'Federico Paz', personId: 'p14' },
]

// ── Escuela: series semanales de clases (también ocupan la agenda) ──
type LessonSeed = { key: string; courtId: string; start: Minutes; end: Minutes; title: string; coachId: string; lessonType: 'individual' | 'group'; capacity: number; studentIds: string[]; offsets: number[]; note?: string }
const LESSON_SEEDS: LessonSeed[] = [
  { key: 'menores', courtId: 'c1', start: h(8), end: h(9, 30), title: 'Escuela · Menores', coachId: 'p15', lessonType: 'group', capacity: 6, studentIds: ['p19', 'p6', 'p9', 'p12'], offsets: [-5, 0, 2, 7] },
  { key: 'camila', courtId: 'c3', start: h(16), end: h(17), title: 'Clase individual', coachId: 'p16', lessonType: 'individual', capacity: 1, studentIds: ['p7'], offsets: [-4, 0, 3, 7] },
  { key: 'adultos', courtId: 'c3', start: h(18), end: h(19), title: 'Escuela · Adultos', coachId: 'p15', lessonType: 'group', capacity: 6, studentIds: ['p2', 'p3', 'p11', 'p14', 'p17'], offsets: [-5, 0, 2, 7], note: 'Traer raqueta propia' },
  { key: 'competencia', courtId: 'c4', start: h(17), end: h(18, 30), title: 'Escuela · Competencia', coachId: 'p16', lessonType: 'group', capacity: 4, studentIds: ['p10', 'p12', 'p21'], offsets: [-6, -1, 1, 6, 8] },
  { key: 'bruno', courtId: 'c6', start: h(9), end: h(10), title: 'Clase individual', coachId: 'p15', lessonType: 'individual', capacity: 1, studentIds: ['p17'], offsets: [1, 8] },
]
const COACH_NAME: Record<string, string> = { p15: 'Diego Ledesma', p16: 'Lucía Ferreyra' }

function lessonOccupations(): Occupation[] {
  return LESSON_SEEDS.flatMap((seed) => seed.offsets.map((offset) => ({
    id: `l-${seed.key}-${offset}`,
    courtId: seed.courtId,
    date: addDays(TODAY, offset),
    start: seed.start,
    end: seed.end,
    kind: 'lesson' as const,
    title: seed.title,
    coach: COACH_NAME[seed.coachId],
    coachId: seed.coachId,
    lessonType: seed.lessonType,
    capacity: seed.capacity,
    studentIds: seed.studentIds,
    students: seed.studentIds.length,
    series: seed.offsets.length > 1,
    seriesId: `ls-${seed.key}`,
    note: seed.note,
  })))
}

// ── Torneos ─────────────────────────────────────────────────────────
export type TournamentStatus = 'draft' | 'registration' | 'in_progress' | 'completed'
export type TCategory = { id: string; name: string; modality: 'singles' | 'doubles'; entries: Entry[]; matches: Match[] }
export type Tournament = { id: string; name: string; description?: string; startsOn: string; endsOn: string; status: TournamentStatus; categories: TCategory[] }

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: 'Borrador',
  registration: 'Inscripción abierta',
  in_progress: 'En juego',
  completed: 'Finalizado',
}

/** «Martina Gómez» → «M. Gómez» (snapshot del nombre en la inscripción). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}
export function entryFor(id: string, people: Person[], personIds: string[]): Entry {
  const names = personIds.map((pid) => people.find((person) => person.id === pid)?.name ?? '')
  return { id, personIds, name: personIds.length > 1 ? names.map((name) => name.split(/\s+/).slice(1).join(' ') || name).join(' / ') : shortName(names[0] ?? '') }
}

type MatchPlan = { occupation: Occupation; categoryId: string; matchId: string }

function buildTournaments(): { tournaments: Tournament[]; matchOccupations: Occupation[] } {
  const e = (catId: string, ids: string[][]) => ids.map((personIds, index) => entryFor(`${catId}-e${index + 1}`, PEOPLE, personIds))
  const plans: MatchPlan[] = []
  const schedule = (tournamentId: string, categoryId: string, matchId: string, occ: Omit<Occupation, 'id' | 'kind' | 'matchRef'>) => {
    const occupation: Occupation = { ...occ, id: `mt-${matchId}`, kind: 'match', matchRef: { tournamentId, categoryId, matchId } }
    plans.push({ occupation, categoryId, matchId })
    return occupation.id
  }

  // Primavera · Damas B (7 inscriptas, un pase libre): cuartos jugados, semifinales programadas.
  const damasB = e('db', [['p1'], ['p7'], ['p11'], ['p9'], ['p3'], ['p5'], ['p16']])
  let damasBMatches = generateFixture(['db-e1', 'db-e2', 'db-e3', 'db-e4', 'db-e5', null, 'db-e6', 'db-e7'], 'db')
  damasBMatches = recordResult(damasBMatches, 'db-r1-0', 'a', '6-3 6-4')
  damasBMatches = recordResult(damasBMatches, 'db-r1-1', 'a', '7-5 6-2')
  damasBMatches = recordResult(damasBMatches, 'db-r1-3', 'a', '6-1 6-1')
  damasBMatches = damasBMatches.map((match) => {
    if (match.id === 'db-r2-0') return { ...match, occupationId: schedule('t-primavera', 'db', match.id, { courtId: 'c2', date: addDays(TODAY, 4), start: h(10), end: h(11, 30), title: 'Gómez vs. Sosa', note: 'Primavera · Damas B · Semifinal' }) }
    if (match.id === 'db-r2-1') return { ...match, occupationId: schedule('t-primavera', 'db', match.id, { courtId: 'c2', date: addDays(TODAY, 4), start: h(11, 30), end: h(13), title: 'Ramírez vs. Ríos', note: 'Primavera · Damas B · Semifinal' }) }
    return match
  })

  // Primavera · Caballeros B (8): un cuarto en juego ahora, dos jugados, uno programado mañana.
  const cabB = e('cb', [['p4'], ['p12'], ['p2'], ['p6'], ['p10'], ['p8'], ['p13'], ['p14']])
  let cabBMatches = generateFixture(cabB.map((entry) => entry.id), 'cb')
  cabBMatches = recordResult(cabBMatches, 'cb-r1-1', 'a', '6-4 3-6 10-7')
  cabBMatches = recordResult(cabBMatches, 'cb-r1-2', 'a', '6-2 6-1')
  cabBMatches = cabBMatches.map((match) => {
    if (match.id === 'cb-r1-0') return { ...match, occupationId: schedule('t-primavera', 'cb', match.id, { courtId: 'c2', date: TODAY, start: h(18), end: h(19, 30), title: 'Peralta vs. Romero', note: 'Primavera · Caballeros B · Cuartos' }) }
    if (match.id === 'cb-r1-3') return { ...match, occupationId: schedule('t-primavera', 'cb', match.id, { courtId: 'c5', date: addDays(TODAY, 1), start: h(20), end: h(21, 30), title: 'Vera vs. Paz', note: 'Primavera · Caballeros B · Cuartos' }) }
    return match
  })

  // Primavera · Dobles mixto: inscripción abierta, sin cuadro.
  const mixto = e('dm', [['p2', 'p3'], ['p4', 'p9'], ['p10', 'p11'], ['p14', 'p7'], ['p12', 'p21']])

  // Invierno (finalizado): campeones visibles.
  const invA = e('ia', [['p10'], ['p12'], ['p2'], ['p17']])
  let invAMatches = generateFixture(invA.map((entry) => entry.id), 'ia')
  invAMatches = recordResult(invAMatches, 'ia-r1-0', 'a', '6-3 6-2')
  invAMatches = recordResult(invAMatches, 'ia-r1-1', 'a', '7-6 6-4')
  invAMatches = recordResult(invAMatches, 'ia-r2-0', 'a', '6-4 4-6 6-3')
  const invD = e('id', [['p7'], ['p9'], ['p11'], ['p21']])
  let invDMatches = generateFixture(invD.map((entry) => entry.id), 'id')
  invDMatches = recordResult(invDMatches, 'id-r1-0', 'a', '6-2 6-3')
  invDMatches = recordResult(invDMatches, 'id-r1-1', 'b', '6-4 6-4')
  invDMatches = recordResult(invDMatches, 'id-r2-0', 'a', '7-5 6-7 6-2')

  const tournaments: Tournament[] = [
    {
      id: 't-primavera',
      name: 'Torneo Primavera 2026',
      description: 'Singles por categoría y dobles mixto. Partidos al mejor de tres sets con super tie-break.',
      startsOn: addDays(TODAY, -9),
      endsOn: addDays(TODAY, 12),
      status: 'in_progress',
      categories: [
        { id: 'db', name: 'Damas B · Singles', modality: 'singles', entries: damasB, matches: damasBMatches },
        { id: 'cb', name: 'Caballeros B · Singles', modality: 'singles', entries: cabB, matches: cabBMatches },
        { id: 'dm', name: 'Dobles mixto', modality: 'doubles', entries: mixto, matches: [] },
      ],
    },
    {
      id: 't-aniversario',
      name: 'Copa Aniversario',
      description: 'Abierto a socios y no socios.',
      startsOn: addDays(TODAY, 20),
      endsOn: addDays(TODAY, 28),
      status: 'registration',
      categories: [
        { id: 'aa', name: 'Caballeros A · Singles', modality: 'singles', entries: e('aa', [['p10'], ['p17'], ['p20']]), matches: [] },
        { id: 'ad', name: 'Damas A · Singles', modality: 'singles', entries: e('ad', [['p9'], ['p21']]), matches: [] },
      ],
    },
    {
      id: 't-invierno',
      name: 'Torneo de Invierno 2026',
      startsOn: addDays(TODAY, -125),
      endsOn: addDays(TODAY, -111),
      status: 'completed',
      categories: [
        { id: 'ia', name: 'Caballeros A · Singles', modality: 'singles', entries: invA, matches: invAMatches },
        { id: 'id', name: 'Damas A · Singles', modality: 'singles', entries: invD, matches: invDMatches },
      ],
    },
  ]
  return { tournaments, matchOccupations: plans.map((plan) => plan.occupation) }
}

/** Generador determinístico para que los otros días tengan agenda creíble y estable. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function generateDay(date: string, offset: number): Occupation[] {
  const random = seeded(offset * 97 + 13)
  const pool = PEOPLE.filter((person) => !person.coach && person.active && person.id !== 'p1')
  const out: Occupation[] = []
  COURTS.forEach((court) => {
    let cursor = h(8) + Math.floor(random() * 4) * 30
    while (cursor < h(22)) {
      const busy = random() < (cursor >= h(17) ? 0.72 : 0.32)
      const length = random() < 0.55 ? 60 : 90
      if (busy && cursor + length <= h(23)) {
        const person = pool[Math.floor(random() * pool.length)]
        out.push({ id: `g-${date}-${court.id}-${cursor}`, courtId: court.id, date, start: cursor, end: cursor + length, kind: 'reservation', title: person.name, personId: person.id })
        cursor += length
      } else {
        cursor += 30
      }
    }
  })
  return out
}

export function buildSeed() {
  const { tournaments, matchOccupations } = buildTournaments()
  const list: Occupation[] = todayOccupations.map((occupation, index) => ({ ...occupation, id: `t-${index}`, date: TODAY }))
  // Turnos de la jugadora del portal (Martina): pasados y próximos.
  const fixed: Occupation[] = [
    { id: 'm-1', courtId: 'c3', date: addDays(TODAY, 1), start: h(19), end: h(20, 30), kind: 'reservation', title: 'Martina Gómez', personId: 'p1' },
    { id: 'm-3', courtId: 'c6', date: addDays(TODAY, -2), start: h(18), end: h(19), kind: 'reservation', title: 'Martina Gómez', personId: 'p1' },
    { id: 'm-4', courtId: 'c1', date: addDays(TODAY, -6), start: h(9), end: h(10, 30), kind: 'reservation', title: 'Martina Gómez', personId: 'p1' },
    ...lessonOccupations(),
    ...matchOccupations,
  ]
  const clashes = (item: Occupation) => fixed.some((other) => other.date === item.date && other.courtId === item.courtId && other.start < item.end && item.start < other.end)
  for (let offset = -6; offset <= 8; offset += 1) {
    if (offset === 0) continue
    list.push(...generateDay(addDays(TODAY, offset), offset + 10).filter((item) => !clashes(item)))
  }
  return { occupations: [...list, ...fixed], tournaments }
}

// ── Cantina ─────────────────────────────────────────────────────────
export type CategoryId = 'bebidas' | 'cocina' | 'kiosco' | 'tenis'
export type Category = { id: CategoryId; name: string }
export const CATEGORIES: Category[] = [
  { id: 'bebidas', name: 'Bebidas' },
  { id: 'cocina', name: 'Cocina' },
  { id: 'kiosco', name: 'Kiosco' },
  { id: 'tenis', name: 'Tenis' },
]

export type Product = { id: string; categoryId: CategoryId; name: string; detail?: string; priceCents: number; popular?: boolean; icon: 'bottle' | 'cup' | 'burger' | 'candy' | 'ball' | 'grip' }
export const PRODUCTS: Product[] = [
  { id: 'agua', categoryId: 'bebidas', name: 'Agua mineral', detail: '500 ml', priceCents: 150000, popular: true, icon: 'bottle' },
  { id: 'agua-sab', categoryId: 'bebidas', name: 'Agua saborizada', detail: '500 ml', priceCents: 220000, icon: 'bottle' },
  { id: 'isot', categoryId: 'bebidas', name: 'Isotónica', detail: '500 ml', priceCents: 280000, popular: true, icon: 'bottle' },
  { id: 'gaseosa', categoryId: 'bebidas', name: 'Gaseosa lata', detail: '354 ml', priceCents: 220000, icon: 'bottle' },
  { id: 'cerveza', categoryId: 'bebidas', name: 'Cerveza lata', detail: '473 ml', priceCents: 300000, popular: true, icon: 'bottle' },
  { id: 'cafe', categoryId: 'bebidas', name: 'Café', detail: 'Jarrito', priceCents: 180000, icon: 'cup' },
  { id: 'hamburguesa', categoryId: 'cocina', name: 'Hamburguesa completa', priceCents: 750000, popular: true, icon: 'burger' },
  { id: 'tostado', categoryId: 'cocina', name: 'Tostado J y Q', priceCents: 450000, icon: 'burger' },
  { id: 'empanada', categoryId: 'cocina', name: 'Empanada', detail: 'Carne o J y Q', priceCents: 140000, icon: 'burger' },
  { id: 'papas', categoryId: 'cocina', name: 'Papas fritas', detail: 'Porción', priceCents: 400000, icon: 'burger' },
  { id: 'alfajor', categoryId: 'kiosco', name: 'Alfajor', priceCents: 120000, icon: 'candy' },
  { id: 'barrita', categoryId: 'kiosco', name: 'Barrita de cereal', priceCents: 100000, icon: 'candy' },
  { id: 'banana', categoryId: 'kiosco', name: 'Banana', priceCents: 60000, icon: 'candy' },
  { id: 'pelotas', categoryId: 'tenis', name: 'Tubo de pelotas', detail: 'x3', priceCents: 1200000, icon: 'ball' },
  { id: 'cubregrip', categoryId: 'tenis', name: 'Cubregrip', priceCents: 350000, popular: true, icon: 'grip' },
  { id: 'muniequera', categoryId: 'tenis', name: 'Muñequera', priceCents: 400000, icon: 'grip' },
  { id: 'antivibrador', categoryId: 'tenis', name: 'Antivibrador', priceCents: 250000, icon: 'grip' },
]
export const productById = (id: string) => PRODUCTS.find((product) => product.id === id)

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mercado_pago' | 'other'
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  bank_transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
  other: 'Otro',
}

export type SaleLine = { productId: string; name: string; qty: number; unitCents: number }
export type SalePayment = { amountCents: number; method: PaymentMethod; date: string }
export type Sale = {
  id: string
  date: string
  time: Minutes
  lines: SaleLine[]
  totalCents: number
  personId?: string
  payments: SalePayment[]
  voided?: { reason: string }
}

function line(productId: string, qty: number): SaleLine {
  const product = productById(productId)!
  return { productId, name: product.name, qty, unitCents: product.priceCents }
}
function sale(id: string, date: string, time: Minutes, lines: SaleLine[], personId: string | undefined, paid: PaymentMethod | null): Sale {
  const totalCents = lines.reduce((sum, item) => sum + item.qty * item.unitCents, 0)
  return { id, date, time, lines, totalCents, personId, payments: paid ? [{ amountCents: totalCents, method: paid, date }] : [] }
}

export function buildSales(): Sale[] {
  return [
    sale('s-1', TODAY, h(9, 12), [line('cafe', 2)], undefined, 'cash'),
    sale('s-2', TODAY, h(10, 40), [line('agua', 2), line('barrita', 1)], undefined, 'cash'),
    sale('s-3', TODAY, h(12, 5), [line('tostado', 1), line('gaseosa', 1)], 'p4', 'mercado_pago'),
    sale('s-4', TODAY, h(16, 50), [line('isot', 2)], 'p7', null),
    sale('s-5', TODAY, h(17, 20), [line('pelotas', 1), line('cubregrip', 2)], 'p2', 'bank_transfer'),
    sale('s-6', TODAY, h(17, 45), [line('agua', 3)], undefined, 'cash'),
    sale('s-7', TODAY, h(18, 5), [line('cerveza', 2), line('papas', 1)], 'p8', null),
    sale('s-8', addDays(TODAY, -1), h(21, 10), [line('hamburguesa', 2), line('cerveza', 2)], 'p10', null),
    sale('s-9', addDays(TODAY, -3), h(20, 30), [line('empanada', 6), line('gaseosa', 2)], 'p12', null),
    sale('s-10', addDays(TODAY, -5), h(19, 0), [line('cubregrip', 1)], 'p7', null),
    { ...sale('s-11', addDays(TODAY, -2), h(18, 30), [line('hamburguesa', 1), line('agua', 1)], 'p10', null), payments: [{ amountCents: 500000, method: 'cash', date: addDays(TODAY, -1) }] },
  ]
}

export const paidCents = (item: Sale) => item.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
export const balanceCents = (item: Sale) => (item.voided ? 0 : item.totalCents - paidCents(item))

// ── Cuotas: obligaciones por período y pagos auditables (D011) ──────
export type FeeSettings = { monthlyCents: number; dueDay: number }
export type Due = { id: string; personId: string; period: string; amountCents: number; dueDate: string }
export type DuePayment = { id: string; dueId: string; amountCents: number; date: string; method: PaymentMethod; reference?: string; voided?: { reason: string; date: string } }

export const FEE_SETTINGS: FeeSettings = { monthlyCents: 3500000, dueDay: 10 }

/** 'YYYY-MM' del mes de una fecha ISO, con desplazamiento de meses. */
export function periodOf(iso: string, shift = 0): string {
  const [y, m] = iso.split('-').map(Number)
  const date = new Date(y, m - 1 + shift, 1, 12)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
export const CURRENT_PERIOD = periodOf(TODAY)

export function buildDues(): { dues: Due[]; payments: DuePayment[] } {
  const members = PEOPLE.filter((person) => person.active && person.membership === 'active')
  const periods = [periodOf(TODAY, -2), periodOf(TODAY, -1), CURRENT_PERIOD]
  const dues: Due[] = []
  const payments: DuePayment[] = []
  const methods: PaymentMethod[] = ['cash', 'bank_transfer', 'mercado_pago', 'cash', 'bank_transfer']
  periods.forEach((period, periodIndex) => {
    const amountCents = periodIndex === 0 ? 3200000 : 3500000
    members.forEach((member, memberIndex) => {
      if (member.id === 'p17' && periodIndex === 0) return // alta reciente
      const id = `d-${period}-${member.id}`
      dues.push({ id, personId: member.id, period, amountCents, dueDate: `${period}-10` })
      const pay = (cents: number, day: number, extra: Partial<DuePayment> = {}) => payments.push({ id: `dp-${id}-${payments.length}`, dueId: id, amountCents: cents, date: `${period}-${String(day).padStart(2, '0')}`, method: methods[(memberIndex + periodIndex) % methods.length], ...extra })
      if (periodIndex < 2) {
        if (member.id === 'p10') return
        if (member.id === 'p12' && periodIndex === 1) { pay(2000000, 12); return }
        pay(amountCents, 3 + (memberIndex % 9))
        return
      }
      // Período actual: algunas pagas, parciales y pendientes.
      if (['p2', 'p4', 'p7', 'p11', 'p15', 'p16', 'p21'].includes(member.id)) pay(amountCents, 2 + (memberIndex % 8), member.id === 'p4' ? { reference: 'Transf. 4471' } : {})
      else if (member.id === 'p6') pay(1500000, 9)
      else if (member.id === 'p14') pay(2000000, 6)
      else if (member.id === 'p3') pay(amountCents, 5, { voided: { reason: 'Importe cargado en la ficha equivocada', date: `${period}-05` } })
    })
  })
  return { dues, payments }
}

// ── Portal del jugador e invitaciones (D015) ────────────────────────
export const PLAYER_ID = 'p1'
export type BookingRules = {
  enabled: boolean
  opensAt: Minutes
  closesAt: Minutes
  durations: number[]
  maxAdvanceDays: number
  maxActive: number
  cancelLeadHours: number
}
export const BOOKING_RULES: BookingRules = {
  enabled: true,
  opensAt: h(8),
  closesAt: h(22),
  durations: [60, 90],
  maxAdvanceDays: 7,
  maxActive: 3,
  cancelLeadHours: 3,
}

export type Invitation = { id: string; personId: string; code: string; createdOn: string; expiresOn: string; redeemedOn?: string; revokedOn?: string }
export type InvitationStatus = 'pending' | 'redeemed' | 'revoked' | 'expired'
export function invitationStatus(invitation: Invitation): InvitationStatus {
  if (invitation.redeemedOn) return 'redeemed'
  if (invitation.revokedOn) return 'revoked'
  if (invitation.expiresOn < TODAY) return 'expired'
  return 'pending'
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** Código de 32 caracteres (en producción se guarda solo su hash y se muestra una única vez). */
export function makeCode(seed: number): string {
  const random = seeded(seed)
  return Array.from({ length: 32 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('')
}
export const normalizeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')
export const groupCode = (code: string) => code.match(/.{1,4}/g)?.join(' ') ?? code

export const INVITATIONS: Invitation[] = [
  { id: 'i-1', personId: 'p2', code: makeCode(11), createdOn: addDays(TODAY, -2), expiresOn: addDays(TODAY, 5) },
  { id: 'i-2', personId: 'p11', code: makeCode(12), createdOn: addDays(TODAY, -6), expiresOn: addDays(TODAY, 1) },
  { id: 'i-3', personId: 'p1', code: makeCode(13), createdOn: addDays(TODAY, -60), expiresOn: addDays(TODAY, -53), redeemedOn: addDays(TODAY, -59) },
  { id: 'i-4', personId: 'p4', code: makeCode(14), createdOn: addDays(TODAY, -21), expiresOn: addDays(TODAY, -14), redeemedOn: addDays(TODAY, -20) },
  { id: 'i-5', personId: 'p8', code: makeCode(15), createdOn: addDays(TODAY, -12), expiresOn: addDays(TODAY, -5), revokedOn: addDays(TODAY, -10) },
  { id: 'i-6', personId: 'p6', code: makeCode(16), createdOn: addDays(TODAY, -10), expiresOn: addDays(TODAY, -3) },
]
