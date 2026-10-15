/*
 * Cuadro de eliminación directa del prototipo (escritorio: rondas en columnas con conectores; celular: pestañas de
 * ronda + páginas deslizables). Solo presenta datos: la generación y el avance del cuadro viven en PostgreSQL.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useIsMobile } from './media'
import { Icon } from './ui'
import { roundName, roundShort, scoreBySide, type BracketMatch } from './bracketUtils'

/** Tarjeta de partido: dos filas (a / b), sets por columna y estado al pie. */
export function MatchCard({ match, onOpen, label }: { match: BracketMatch; onOpen?: () => void; label?: string }) {
  const sets = scoreBySide(match)
  const live = Boolean(match.when?.live) && match.state !== 'done'
  const unparsed = match.state === 'done' && !match.walkover && match.score && sets.a.length === 0
  const foot = match.state === 'bye' ? 'Pase libre'
    : match.state === 'done' ? (match.walkover ? 'Ganó por W.O.' : unparsed ? `Marcador: ${match.score}` : 'Finalizado')
      : match.state === 'waiting' ? 'Esperando rival'
        : match.when ? match.when.text : 'Por programar'
  const row = (side: 'a' | 'b', name: string | null) => (
    <span className={`mcard-row ${match.winner === side ? 'is-winner' : match.winner ? 'is-loser' : ''}`}>
      <span className={`mcard-name ${name ? '' : 'is-empty'}`}>{name ?? (match.state === 'bye' ? 'Pase libre' : 'A definir')}</span>
      <span className="mcard-sets num">{sets[side].map((games, index) => <b key={index}>{games}</b>)}</span>
      {match.winner === side && <Icon name="check" size={16} className="mcard-check" />}
    </span>
  )
  const body = (
    <>
      {label && <span className="mcard-label">{label}</span>}
      {row('a', match.a)}
      {row('b', match.b)}
      <span className={`mcard-foot is-${match.state} ${live ? 'is-live' : ''}`}>
        {live ? <><i />En juego · {match.when?.text.split(' · ').slice(1).join(' · ')}</> : foot}
      </span>
    </>
  )
  const className = `mcard is-${match.state} ${live ? 'is-live' : ''}`
  if (!onOpen || match.state === 'bye') return <div className={className}>{body}</div>
  return <button type="button" className={className} onClick={onOpen} aria-label={`${match.a ?? 'A definir'} contra ${match.b ?? 'A definir'}. ${foot}`}>{body}</button>
}

export function Bracket({ matches, onOpen }: { matches: BracketMatch[]; onOpen?: (match: BracketMatch) => void }) {
  const isMobile = useIsMobile()
  if (matches.length === 0) return null
  const rounds = Math.max(...matches.map((match) => match.round))
  const firstRound = 2 ** (rounds - 1)
  const list = Array.from({ length: rounds }, (_, index) => index + 1)
  return isMobile ? <RoundCarousel matches={matches} rounds={list} onOpen={onOpen} /> : (
    <div className="bracket-board" tabIndex={0} aria-label="Cuadro del torneo" style={{ '--first': firstRound } as CSSProperties}>
      {list.map((round) => {
        const inRound = matches.filter((match) => match.round === round).sort((x, y) => x.position - y.position)
        const pairs = round === rounds ? [inRound] : Array.from({ length: Math.ceil(inRound.length / 2) }, (_, index) => inRound.slice(index * 2, index * 2 + 2))
        return (
          <section key={round} className={`bk-round ${round === rounds ? 'is-final' : ''}`} aria-label={roundName(round, rounds)}>
            <p className="bk-round-name">{roundName(round, rounds)}<span>{inRound.filter((match) => match.winner).length}/{inRound.length}</span></p>
            <div className="bk-slots">
              {pairs.map((pair, index) => (
                <div key={index} className={`bk-pair ${round === rounds ? 'is-final' : ''}`}>
                  {pair.map((match) => (
                    <div key={match.id} className="bk-slot">
                      <MatchCard match={match} onOpen={onOpen ? () => onOpen(match) : undefined} />
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

function RoundCarousel({ matches, rounds, onOpen }: { matches: BracketMatch[]; rounds: number[]; onOpen?: (match: BracketMatch) => void }) {
  const total = rounds.length
  // Arranca en la ronda en curso: la primera con partidos sin definir.
  const current = rounds.find((round) => matches.some((match) => match.round === round && !match.winner && match.state !== 'bye')) ?? total
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
                <li key={match.id}><MatchCard match={match} onOpen={onOpen ? () => onOpen(match) : undefined} /></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="round-hint"><Icon name="swap" size={14} />Deslizá para ver la ronda siguiente</p>
    </div>
  )
}
