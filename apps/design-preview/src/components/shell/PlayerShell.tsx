import { useState, type ReactNode } from 'react'
import { NOW, PLAYER_ID, TODAY } from '../../data/mock'
import { usePeople } from '../../lib/data'
import { useScrolled } from '../../lib/media'
import type { RoutePath } from '../../lib/router'
import { useStore } from '../../lib/store'
import { capitalize, dateShort, hhmm, weekdayShort } from '../../lib/time'
import { Avatar, Crest, Icon, Modal, type IconName } from '../ui'

const PLAYER_NAV: { path: RoutePath; label: string; icon: IconName }[] = [
  { path: '/jugador/inicio', label: 'Inicio', icon: 'home' },
  { path: '/jugador/turnos', label: 'Mis turnos', icon: 'calendar' },
  { path: '/jugador/reservar', label: 'Reservar', icon: 'plus' },
  { path: '/jugador/torneos', label: 'Torneos', icon: 'trophy' },
  { path: '/jugador/perfil', label: 'Perfil', icon: 'user' },
]

export function PlayerShell({ route, navigate, children }: { route: RoutePath; navigate: (path: RoutePath) => void; children: ReactNode }) {
  const [account, setAccount] = useState(false)
  const { state } = useStore()
  const me = usePeople().byId(PLAYER_ID)!
  const scrolled = useScrolled()
  const current = PLAYER_NAV.find((item) => item.path === route)
  const go = (path: RoutePath) => { setAccount(false); navigate(path) }

  return (
    <div className="player-shell">
      <a className="skip-link" href="#contenido-jugador">Saltar al contenido</a>
      <header className={`player-header texture-court ${scrolled ? 'is-condensed' : ''}`}>
        <h1 className="visually-hidden">{current?.label ?? 'Inicio'} · Portal de jugadores de {state.club.name}</h1>
        <div className="player-header-inner">
          <p className="player-clock show-mobile" aria-label={`Hoy ${hhmm(NOW)}`}>
            <span aria-hidden="true">{capitalize(weekdayShort(TODAY))} {dateShort(TODAY)}</span>
            <b className="num" aria-hidden="true">{hhmm(NOW)}</b>
          </p>
          <button type="button" className="player-brand" onClick={() => go('/jugador/inicio')} aria-label={`${state.club.name}, inicio del portal`}>
            <span className="player-brand-crest"><span className="topbar-crest-plinth" aria-hidden="true" /><Crest size={60} /></span>
            <span className="player-brand-text hide-mobile"><strong className="display">{state.club.name}</strong><small>Portal de jugadores</small></span>
          </button>
          <nav className="player-topnav" aria-label="Portal de jugadores">
            {PLAYER_NAV.map((item) => (
              <button key={item.path} type="button" className={`player-toplink ${route === item.path ? 'is-active' : ''} ${item.path === '/jugador/reservar' ? 'is-cta' : ''}`} aria-current={route === item.path ? 'page' : undefined} onClick={() => go(item.path)}>
                <Icon name={item.icon} size={18} />{item.label}
              </button>
            ))}
          </nav>
          <button type="button" className="player-avatar" aria-label="Cuenta" onClick={() => setAccount(true)}>
            <Avatar name={me.name} size="sm" />
          </button>
        </div>
      </header>

      <main id="contenido-jugador" className="player-content" tabIndex={-1}>{children}</main>

      <nav className="bottom-nav bottom-nav-player" aria-label="Portal de jugadores">
        {PLAYER_NAV.map((item) => item.path === '/jugador/reservar' ? (
          <button key={item.path} type="button" className="bottom-fab" aria-label="Reservar cancha" aria-current={route === item.path ? 'page' : undefined} onClick={() => go(item.path)}>
            <span><Icon name="plus" size={28} /></span>
          </button>
        ) : (
          <button key={item.path} type="button" className={`bottom-link ${route === item.path ? 'is-active' : ''}`} aria-current={route === item.path ? 'page' : undefined} onClick={() => go(item.path)}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <Modal open={account} onClose={() => setAccount(false)} title="Cuenta" size="sm">
        <div className="account">
          <div className="account-id">
            <Avatar name={me.name} size="lg" />
            <div><strong>{me.name}</strong><span>martina.gomez@correo.test</span></div>
          </div>
          <div className="account-actions">
            <button type="button" className="menu-item" onClick={() => go('/admin/inicio')}><Icon name="swap" />Cambiar a administración <span className="menu-item-note">demo</span></button>
            <button type="button" className="menu-item" onClick={() => go('/jugador/perfil')}><Icon name="user" />Mi perfil</button>
            <button type="button" className="menu-item" onClick={() => go('/sistema')}><Icon name="layers" />Design system</button>
            <button type="button" className="menu-item" onClick={() => go('/acceso')}><Icon name="logout" />Cerrar sesión <span className="menu-item-note">simulado</span></button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
