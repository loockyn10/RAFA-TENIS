/*
 * Cuadro de eliminación directa: escritorio con todas las rondas y conectores; celular con
 * navegación por rondas (pestañas + carrusel con scroll-snap que deja ver la ronda siguiente).
 * Solo presenta datos: la lógica vive en src/lib/tournament.ts.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Occupation } from '../data/mock'
import { matchWhen } from '../lib/data'
import { useIsMobile } from '../lib/media'
import { entryLabel, matchState, roundName, roundShort, scoreBySide, type Entry, type Match } from '../lib/tournament'
import { Icon } from './ui'

export type BracketContext = {
  entries: Entry[]
  occupations: Occupation[]
  courtName: (id: string) => string
  highlight?: string
}

/** Tarjeta de partido: dos filas (lado a / lado b), sets por columna y estado al pie. */
export function MatchCard({ match, ctx, onOpen, label }: { match: Match; ctx: BracketContext; onOpen?: () => void; label?: string }) {
  const state = matchState(match)
  const sets = scoreBySide(match)
  const when = matchWhen(match, ctx)
  const a = entryLabel(ctx.entries, match.a)
  const b = entryLabel(ctx.entries, match.b)
  const foot = state === 'bye' ? 'Pase libre'
    : state === 'done' ? (match.walkover ? 'Ganó por W.O.' : 'Finalizado')
      : state === 'waiting' ? 'Esperando rival'
        : when ? when.text : 'Por programar'
  const row = (side: 'a' | 'b', name: string | null) => (
    <span className={`mcard-row ${match.winner === side ? 'is-winner' : match.winner ? 'is-loser' : ''} ${ctx.highlight && match[side] === ctx.highlight ? 'is-highlight' : ''}`}>
      <span className={`mcard-name ${name ? '' : 'is-empty'}`}>{name ?? (state === 'bye' ? 'Pase libre' : 'A definir')}</span>
      <span className="mcard-sets num">{sets[side].map((games, index) => <b key={index}>{games}</b>)}</span>
      {match.winner === side && <Icon name="check" size={16} className="mcard-check" />}
    </span>
  )
  const body = (
    <>
      {label && <span className="mcard-label">{label}</span>}
      {row('a', a)}
      {row('b', b)}
      <span className={`mcard-foot is-${state} ${when?.live && state !== 'done' ? 'is-live' : ''}`}>
        {when?.live && state !== 'done' ? <><i />En juego · {when.text.split(' · ').slice(2).join(' · ')}</> : foot}
      </span>
    </>
  )
  const className = `mcard is-${state} ${when?.live && state !== 'done' ? 'is-live' : ''}`
  if (!onOpen || state === 'bye') return <div className={className}>{body}</div>
  return <button type="button" className={className} onClick={onOpen} aria-label={`${a ?? 'A definir'} contra ${b ?? 'A definir'}. ${foot}`}>{body}</button>
}

export function Bracket({ matches, ctx, onOpen }: { matches: Match[]; ctx: BracketContext; onOpen?: (match: Match) => void }) {
  const isMobile = useIsMobile()
  const firstRound = matches.filter((match) => match.round === 1).length
  const rounds = Math.round(Math.log2(firstRound * 2))
  const list = Array.from({ length: rounds }, (_, index) => index + 1)
  if (matches.length === 0) return null
  return isMobile ? <RoundCarousel matches={matches} rounds={list} ctx={ctx} onOpen={onOpen} /> : (
    <div className="bracket-board" tabIndex={0} aria-label="Cuadro del torneo" style={{ '--first': firstRound } as CSSProperties}>
      {list.map((round) => {
        const inRound = matches.filter((match) => match.round === round).sort((x, y) => x.position - y.position)
        const pairs = round === rounds ? [inRound] : Array.from({ length: inRound.length / 2 }, (_, index) => inRound.slice(index * 2, index * 2 + 2))
        return (
          <section key={round} className={`bk-round ${round === rounds ? 'is-final' : ''}`} aria-label={roundName(round, rounds)}>
            <p className="bk-round-name">{roundName(round, rounds)}<span>{inRound.filter((match) => match.winner).length}/{inRound.length}</span></p>
            <div className="bk-slots">
              {pairs.map((pair, index) => (
                <div key={index} className={`bk-pair ${round === rounds ? 'is-final' : ''}`}>
                  {pair.map((match) => (
                    <div key={match.id} className="bk-slot">
                      <MatchCard match={match} ctx={ctx} onOpen={onOpen ? () => onOpen(match) : undefined} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function RoundCarousel({ matches, rounds, ctx, onOpen }: { matches: Match[]; rounds: number[]; ctx: BracketContext; onOpen?: (match: Match) => void }) {
  const total = rounds.length
  // Arranca en la ronda en curso: la primera con partidos sin definir.
  const current = rounds.find((round) => matches.some((match) => match.round === round && !match.winner && matchState(match) !== 'bye')) ?? total
  const [active, setActive] = useState(current)
  const scroller = useRef<HTMLDivElement>(null)
  const scrollTo = (round: number, smooth = true) => {
    const node = scroller.current?.children[round - 1] as HTMLElement | undefined
    if (node && scroller.current) scroller.current.scrollTo({ left: node.offsetLeft - scroller.current.offsetLeft, behavior: smooth ? 'smooth' : 'auto' })
  }
  useEffect(() => { scrollTo(current, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    const width = (node.children[0] as HTMLElement | undefined)?.offsetWidth ?? node.clientWidth
    const index = Math.round(node.scrollLeft / Math.max(1, width + 12)) + 1
    if (index !== active) setActive(Math.min(total, Math.max(1, index)))
  }
  return (
    <div className="round-nav">
      <div className="round-tabs" role="tablist" aria-label="Rondas">
        {rounds.map((round) => {
          const inRound = matches.filter((match) => match.round === round)
          const done = inRound.every((match) => match.winner)
          return (
            <button key={round} type="button" role="tab" aria-selected={round === active} className={`round-tab ${round === active ? 'is-selected' : ''} ${done ? 'is-done' : ''}`} onClick={() => { setActive(round); scrollTo(round) }}>
              <span>{roundShort(round, total)}</span>
              <small>{done ? <Icon name="check" size={12} /> : `${inRound.filter((match) => match.winner).length}/${inRound.length}`}</small>
            </button>
          )
        })}
      </div>
      <div className="round-pages" ref={scroller} onScroll={onScroll}>
        {rounds.map((round) => (
          <section key={round} className="round-page" aria-label={roundName(round, total)}>
            <p className="bk-round-name">{roundName(round, total)}</p>
            <ul className="round-list">
              {matches.filter((match) => match.round === round).sort((x, y) => x.position - y.position).map((match) => (
                <li key={match.id}><MatchCard match={match} ctx={ctx} onOpen={onOpen ? () => onOpen(match) : undefined} /></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="round-hint"><Icon name="swap" size={14} />Deslizá para ver la ronda siguiente</p>
    </div>
  )
}
