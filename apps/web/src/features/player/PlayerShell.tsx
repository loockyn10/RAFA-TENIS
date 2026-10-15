import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar, Crest, Field, Icon, Modal, SelectInput, type IconName } from '../../design/ui'
import { useScrolled } from '../../design/media'
import type { PlayerClubAccess } from '../../types/domain'

export type PlayerSection = 'home' | 'turns' | 'book' | 'tournaments' | 'news' | 'profile'

const PLAYER_NAV: { section: PlayerSection; label: string; icon: IconName }[] = [
  { section: 'home', label: 'Inicio', icon: 'home' },
  { section: 'turns', label: 'Mis turnos', icon: 'calendar' },
  { section: 'book', label: 'Reservar', icon: 'plus' },
  { section: 'tournaments', label: 'Torneos', icon: 'trophy' },
  { section: 'profile', label: 'Perfil', icon: 'user' },
]

/** Barra superior (≥768 px): suma Novedades. La barra inferior del celular conserva sus 5 accesos; Novedades se alcanza desde Inicio, la campanita y «Cuenta». */
const NEWS_ITEM: { section: PlayerSection; label: string; icon: IconName } = { section: 'news', label: 'Novedades', icon: 'news' }
const PLAYER_TOPNAV = [...PLAYER_NAV.slice(0, 3), NEWS_ITEM, ...PLAYER_NAV.slice(3)]

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Fecha y hora reales del club (zona del club, no la del dispositivo). */
function useClubClock(timezone: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const short = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(now).replace('.', '')
  return { time, short }
}

export type PlayerShellProps = {
  section: PlayerSection
  onNavigate: (section: PlayerSection) => void
  club: PlayerClubAccess
  access: PlayerClubAccess[]
  onSelectClub: (clubId: string) => void
  userEmail: string
  onOpenAdmin?: () => void
  onSignOut: () => void
  signingOut: boolean
  /** Campanita de avisos (se arma en PlayerPortal con el cliente y el club activos). */
  notifications?: ReactNode
  children: ReactNode
}

/** Shell del portal: encabezado con escudo, navegación superior (≥768 px) y barra inferior con «Reservar» destacado en celular. */
export function PlayerShell({ section, onNavigate, club, access, onSelectClub, userEmail, onOpenAdmin, onSignOut, signingOut, notifications, children }: PlayerShellProps) {
  const [account, setAccount] = useState(false)
  const scrolled = useScrolled()
  const clock = useClubClock(club.timezone)
  const current = PLAYER_TOPNAV.find((item) => item.section === section)
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => { contentRef.current?.focus({ preventScroll: true }) }, [section])
  const go = (next: PlayerSection) => { setAccount(false); onNavigate(next) }

  return (
    <div className="rt rt-app player-shell">
      <a className="skip-link" href="#contenido-jugador">Saltar al contenido</a>
      <header className={`player-header texture-court ${scrolled ? 'is-condensed' : ''}`}>
        <h1 className="visually-hidden">{current?.label ?? 'Inicio'} · Portal de jugadores de {club.club_name}</h1>
        <div className="player-header-inner">
          <p className="player-clock show-mobile" aria-label={`Hoy ${clock.time}, hora del club`}>
            <span aria-hidden="true">{capitalize(clock.short)}</span>
            <b className="num" aria-hidden="true">{clock.time}</b>
          </p>
          <button type="button" className="player-brand" onClick={() => go('home')} aria-label={`${club.club_name}, inicio del portal`}>
            <span className="player-brand-crest"><span className="topbar-crest-plinth" aria-hidden="true" /><Crest size={60} /></span>
            <span className="player-brand-text hide-mobile"><strong className="display">{club.club_name}</strong><small>Portal de jugadores</small></span>
          </button>
          <nav className="player-topnav" aria-label="Portal de jugadores">
            {PLAYER_TOPNAV.map((item) => (
              <button key={item.section} type="button" className={`player-toplink ${section === item.section ? 'is-active' : ''} ${item.section === 'book' ? 'is-cta' : ''}`} aria-current={section === item.section ? 'page' : undefined} onClick={() => go(item.section)}>
                <Icon name={item.icon} size={18} />{item.label}
              </button>
            ))}
          </nav>
          <div className="player-tools">
            {notifications}
          <button type="button" className="player-avatar" aria-label="Cuenta" aria-haspopup="dialog" onClick={() => setAccount(true)}>
            <Avatar name={club.full_name} size="sm" />
          </button>
          </div>
        </div>
      </header>

      <main id="contenido-jugador" className="player-content" tabIndex={-1} ref={contentRef}>{children}</main>

      <nav className="rt bottom-nav bottom-nav-player" aria-label="Accesos principales del jugador">
        {PLAYER_NAV.map((item) => item.section === 'book' ? (
          <button key={item.section} type="button" className="bottom-fab" aria-label="Reservar cancha" aria-current={section === item.section ? 'page' : undefined} onClick={() => go(item.section)}>
            <span><Icon name="plus" size={28} /></span>
          </button>
        ) : (
          <button key={item.section} type="button" className={`bottom-link ${section === item.section ? 'is-active' : ''}`} aria-current={section === item.section ? 'page' : undefined} onClick={() => go(item.section)}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <Modal open={account} onClose={() => setAccount(false)} title="Cuenta" size="sm">
        <div className="account">
          <div className="account-id">
            <Avatar name={club.full_name} size="lg" />
            <div><strong>{club.full_name}</strong><span>{userEmail || 'Cuenta autenticada'} · {club.club_name}</span></div>
          </div>
          {access.length > 1 && (
            <Field label="Club">{(id) => (
              <SelectInput id={id} value={club.club_id} onChange={(event) => { onSelectClub(event.target.value); setAccount(false) }}>
                {access.map((item) => <option key={item.club_id} value={item.club_id}>{item.club_name}</option>)}
              </SelectInput>
            )}</Field>
          )}
          <div className="rt-account-actions">
            {onOpenAdmin && <button type="button" className="menu-item" onClick={onOpenAdmin}><Icon name="swap" />Cambiar a administración</button>}
            <button type="button" className="menu-item" onClick={() => go('news')}><Icon name="news" />Novedades del club</button>
            <button type="button" className="menu-item" onClick={() => go('profile')}><Icon name="user" />Mi perfil</button>
            <button type="button" className="menu-item" onClick={onSignOut} disabled={signingOut}><Icon name="logout" />{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
