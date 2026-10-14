import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { KIND_LABEL, NOW, TODAY, type Court, type Occupation } from '../../data/mock'
import { useCourts } from '../../lib/data'
import { busyMinutes, forDay, occupationAt } from '../../lib/agenda'
import { useAdmin } from '../../lib/admin'
import { useIsMobile } from '../../lib/media'
import { plural } from '../../lib/format'
import { useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { addDays, capitalize, DAY_CLOSE, DAY_OPEN, dayLong, dayNumber, hhmm, range, SLOT, slots, weekdayShort } from '../../lib/time'
import { Button, CourtMark, ErrorState, Icon, IconButton, SegmentedTabs, Skeleton } from '../../components/ui'
import { OccupationDetail } from './OccupationDetail'

const GRID = slots()

export function Reservations() {
  const { state } = useStore()
  const { go, goWith, openReservation } = useAdmin()
  const { courts: allCourts } = useCourts()
  const { dataState, retry } = useScreenState()
  const isMobile = useIsMobile()
  const [date, setDate] = useState(TODAY)
  const [pickedCourt, setCourtId] = useState('c1')
  const [mobileView, setMobileView] = useState<'court' | 'overview'>('court')
  const [selected, setSelected] = useState<Occupation | null>(null)

  const occupations = dataState === 'empty' ? [] : state.occupations
  // Canchas activas + inactivas que todavía tienen ocupaciones ese día (para reubicarlas).
  const courts = allCourts.filter((court) => court.active || forDay(occupations, date, court.id).length > 0)
  const courtId = courts.some((court) => court.id === pickedCourt) ? pickedCourt : courts[0]?.id ?? ''
  const day = forDay(occupations, date)
  const busy = courts.reduce((sum, court) => sum + busyMinutes(occupations, court.id, date, DAY_OPEN, DAY_CLOSE), 0)
  const occupancy = Math.round((busy / (Math.max(courts.length, 1) * (DAY_CLOSE - DAY_OPEN))) * 100)
  const overview = isMobile && mobileView === 'overview'
  const visibleCourts = isMobile && !overview ? courts.filter((court) => court.id === courtId) : courts

  const shiftCourt = (delta: number) => {
    const index = courts.findIndex((court) => court.id === courtId)
    setCourtId(courts[(index + delta + courts.length) % courts.length].id)
  }

  return (
    <div className="agenda">
      <div className="agenda-toolbar">
        <div className="date-nav">
          <IconButton icon="chevronLeft" label="Día anterior" variant="secondary" onClick={() => setDate(addDays(date, -1))} />
          <div className="date-nav-label">
            <p className="date-nav-title display">{capitalize(dayLong(date))}</p>
            <p className='date-nav-sub'>{date === TODAY ? 'Hoy · ' : ''}{plural(day.length, 'ocupación', 'ocupaciones')} · {occupancy}% uso</p>
          </div>
          <IconButton icon="chevronRight" label="Día siguiente" variant="secondary" onClick={() => setDate(addDays(date, 1))} />
          {date !== TODAY && <Button variant="ghost" size="sm" onClick={() => setDate(TODAY)}>Hoy</Button>}
          <label className="date-picker" title="Ir a fecha">
            <Icon name="calendar" size={18} />
            <span className="visually-hidden">Ir a fecha</span>
            <input type="date" value={date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => event.target.value && setDate(event.target.value)} />
          </label>
        </div>
        <div className="toolbar-actions hide-mobile">
          <Button variant="secondary" icon="lock" onClick={() => openReservation({ date, mode: 'block' })}>Bloquear cancha</Button>
          <Button variant="secondary" icon="school" onClick={() => go('/admin/escuela')}>Nueva clase</Button>
        </div>
      </div>

      <DateStrip value={date} onChange={setDate} occupations={occupations} />

      <div className="agenda-subbar">
        {isMobile && (
          <SegmentedTabs label="Vista de agenda" size="sm" value={mobileView} onChange={setMobileView} items={[{ id: 'court', label: 'Por cancha' }, { id: 'overview', label: 'Panorama' }]} />
        )}
        <ul className="legend" aria-label="Referencias">
          {(['reservation', 'lesson', 'match', 'block'] as const).map((kind) => (
            <li key={kind}><span className={`legend-swatch occ-${kind}`} aria-hidden="true" />{KIND_LABEL[kind]}</li>
          ))}
        </ul>
      </div>

      {isMobile && !overview && (
        <div className="court-switcher" role="radiogroup" aria-label="Elegir cancha" style={{ '--n': courts.length } as CSSProperties}>
          {courts.map((court) => {
            const now = date === TODAY ? occupationAt(occupations, court.id, date, NOW) : undefined
            const count = forDay(occupations, date, court.id).length
            return (
              <button key={court.id} type="button" role="radio" aria-checked={court.id === courtId} className={`court-switch ${court.id === courtId ? 'is-selected' : ''}`} onClick={() => setCourtId(court.id)}>
                <CourtMark label={court.short} size="sm" tone={court.id === courtId ? 'clay' : 'muted'} />
                <span className="court-switch-meta">{date === TODAY ? (now ? 'En uso' : 'Libre') : plural(count, 'turno', 'turnos')}</span>
              </button>
            )
          })}
        </div>
      )}

      {dataState === 'error' ? (
        <ErrorState title="No pudimos cargar la agenda" onRetry={retry} />
      ) : dataState === 'loading' ? (
        <AgendaSkeleton columns={visibleCourts.length} />
      ) : (
        <>
          {day.length === 0 && (
            <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span><b>Día sin ocupaciones.</b> Tocá cualquier horario para cargar una reserva.</span></p>
          )}
          <AgendaGrid
            date={date}
            courts={visibleCourts}
            occupations={occupations}
            compact={overview}
            onSlot={(court, start) => openReservation({ date, courtId: court, start })}
            onSelect={setSelected}
            onCourtHead={overview ? (id) => { setCourtId(id); setMobileView('court') } : undefined}
          />
          {isMobile && !overview && (
            <div className="court-pager">
              <Button variant="ghost" icon="chevronLeft" onClick={() => shiftCourt(-1)}>Anterior</Button>
              <Button variant="ghost" iconRight="chevronRight" onClick={() => shiftCourt(1)}>Siguiente</Button>
            </div>
          )}
        </>
      )}

      <OccupationDetail
        occupation={selected}
        onClose={() => setSelected(null)}
        onEdit={(occupation) => { setSelected(null); openReservation({ date: occupation.date, editing: occupation }) }}
        onOpenSection={(occupation) => {
          setSelected(null)
          if (occupation.kind === 'lesson') goWith('/admin/escuela', { kind: 'lesson', id: occupation.id })
          else if (occupation.matchRef) goWith('/admin/torneos', { kind: 'match', ...occupation.matchRef })
          else go('/admin/torneos')
        }}
      />
    </div>
  )
}

function DateStrip({ value, onChange, occupations }: { value: string; onChange: (date: string) => void; occupations: Occupation[] }) {
  const days = Array.from({ length: 9 }, (_, index) => addDays(TODAY, index - 1))
  return (
    <div className="date-strip" role="listbox" aria-label="Elegir día">
      {days.map((day) => {
        const load = forDay(occupations, day).length
        const level = load === 0 ? 0 : load < 14 ? 1 : load < 22 ? 2 : 3
        return (
          <button key={day} type="button" role="option" aria-selected={day === value} className={`date-chip ${day === value ? 'is-selected' : ''} ${day === TODAY ? 'is-today' : ''}`} onClick={() => onChange(day)}>
            <span className="date-chip-wd">{day === TODAY ? 'Hoy' : weekdayShort(day)}</span>
            <span className="date-chip-n display num">{dayNumber(day)}</span>
            <span className={`load load-${level}`} aria-label={`${load} ocupaciones`}><i /><i /><i /></span>
          </button>
        )
      })}
    </div>
  )
}

type GridProps = {
  date: string
  courts: Court[]
  occupations: Occupation[]
  compact: boolean
  onSlot: (courtId: string, start: number) => void
  onSelect: (occupation: Occupation) => void
  onCourtHead?: (courtId: string) => void
}

function AgendaGrid({ date, courts, occupations, compact, onSlot, onSelect, onCourtHead }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isToday = date === TODAY

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const rowHeight = parseFloat(getComputedStyle(node).getPropertyValue('--row')) || 32
    const target = isToday ? NOW - 60 : 8 * 60
    node.scrollTop = Math.max(0, ((target - DAY_OPEN) / SLOT) * rowHeight)
  }, [date, isToday])

  const style = { '--cols': courts.length, '--rows': GRID.length } as CSSProperties
  const nowOffset = (NOW - DAY_OPEN) / SLOT

  return (
    <div className={`agenda-scroll ${compact ? 'is-compact' : ''} ${courts.length === 1 ? 'is-single' : ''}`} ref={scrollRef} tabIndex={0} aria-label="Grilla de horarios">
      <div className="agenda-grid" style={style}>
        <div className="agenda-corner" aria-hidden="true" />
        {courts.map((court) => {
          const count = forDay(occupations, date, court.id).length
          const head = (
            <>
              <CourtMark label={court.short} size="sm" />
              <span className="agenda-court-name">{compact ? court.short : court.name}</span>
              {!compact && <span className="agenda-court-meta">{court.active ? plural(count, 'turno', 'turnos') : 'Inactiva'}</span>}
            </>
          )
          return onCourtHead ? (
            <button key={court.id} type="button" className="agenda-court-head" onClick={() => onCourtHead(court.id)} aria-label={`Ver ${court.name}`}>{head}</button>
          ) : (
            <div key={court.id} className="agenda-court-head">{head}</div>
          )
        })}

        <div className="agenda-times" aria-hidden="true">
          {GRID.map((slot) => <div key={slot} className={`agenda-time ${slot % 60 === 0 ? 'is-hour' : ''}`}>{slot % 60 === 0 ? hhmm(slot) : ''}</div>)}
          {isToday && <span className="now-pill num" style={{ '--at': nowOffset } as CSSProperties}>{hhmm(NOW)}</span>}
        </div>

        {courts.map((court) => {
          const items = forDay(occupations, date, court.id)
          const covered = (slot: number) => items.some((item) => item.start <= slot && slot < item.end)
          return (
            <div key={court.id} className="agenda-col" role="group" aria-label={court.name}>
              {GRID.map((slot) => {
                const past = isToday && slot + SLOT <= NOW
                const hidden = covered(slot)
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`agenda-cell ${slot % 60 === 0 ? 'is-hour' : ''} ${past ? 'is-past' : ''}`}
                    tabIndex={hidden ? -1 : 0}
                    aria-hidden={hidden || undefined}
                    aria-label={`Reservar ${court.name} a las ${hhmm(slot)}`}
                    onClick={() => onSlot(court.id, slot)}
                  >
                    {!compact && <span className="agenda-cell-hint"><Icon name="plus" size={14} />{hhmm(slot)}</span>}
                  </button>
                )
              })}
              {items.map((item) => (
                <OccupationBlock key={item.id} occupation={item} compact={compact} past={isToday && item.end <= NOW} live={isToday && item.start <= NOW && NOW < item.end} onClick={() => onSelect(item)} />
              ))}
              {isToday && <span className="now-line" style={{ '--at': nowOffset } as CSSProperties} aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OccupationBlock({ occupation, compact, past, live, onClick }: { occupation: Occupation; compact: boolean; past: boolean; live: boolean; onClick: () => void }) {
  const style = { '--start': (occupation.start - DAY_OPEN) / SLOT, '--span': (occupation.end - occupation.start) / SLOT } as CSSProperties
  const short = occupation.end - occupation.start <= 30
  return (
    <button
      type="button"
      className={`occ occ-${occupation.kind} ${short ? 'is-short' : ''} ${past ? 'is-past' : ''} ${live ? 'is-live' : ''} ${occupation.id.startsWith('new-') ? 'is-new' : ''}`}
      style={style}
      onClick={onClick}
      aria-label={`${KIND_LABEL[occupation.kind]}: ${occupation.title}, ${range(occupation)}`}
    >
      {compact ? (
        <span className="occ-compact-label">{occupation.kind === 'block' ? '' : occupation.title.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
      ) : (
        <>
          <span className="occ-title">{occupation.title}</span>
          <span className="occ-meta num">
            {range(occupation)}
            {occupation.series && <Icon name="repeat" size={13} label="Turno fijo" />}
            {occupation.note && <Icon name="note" size={13} label="Con observación" />}
            {occupation.capacity !== undefined && <span>· {occupation.students}/{occupation.capacity}</span>}
          </span>
          {live && <span className="occ-live">En juego</span>}
        </>
      )}
    </button>
  )
}

function AgendaSkeleton({ columns }: { columns: number }) {
  return (
    <div className="agenda-skeleton" role="status" aria-label="Cargando agenda" style={{ '--cols': columns } as CSSProperties}>
      {Array.from({ length: columns }, (_, index) => (
        <div key={index} className="agenda-skeleton-col">
          <Skeleton height={44} radius={12} />
          <Skeleton height={90} radius={10} />
          <Skeleton height={60} radius={10} />
          <Skeleton height={120} radius={10} />
        </div>
      ))}
      <span className="visually-hidden">Cargando agenda…</span>
    </div>
  )
}
