import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NOW, TODAY } from '../../data/mock'
import { AdminContext } from '../../lib/admin'
import { useScrolled } from '../../lib/media'
import type { RoutePath } from '../../lib/router'
import { useStore, type Intent } from '../../lib/store'
import { capitalize, dateShort, dayLong, hhmm, weekdayShort } from '../../lib/time'
import { ReservationSheet, type ReservationIntent } from '../../screens/admin/ReservationSheet'
import { Avatar, Button, Crest, Icon, IconButton, Modal, type IconName } from '../ui'

type NavItem = { path: RoutePath; label: string; short?: string; icon: IconName }
const ADMIN_NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Operación', items: [
    { path: '/admin/inicio', label: 'Inicio', icon: 'home' },
    { path: '/admin/reservas', label: 'Reservas', icon: 'calendar' },
    { path: '/admin/cantina', label: 'Cantina', icon: 'cart' },
  ] },
  { group: 'Club', items: [
    { path: '/admin/jugadores', label: 'Jugadores', icon: 'users' },
    { path: '/admin/cuotas', label: 'Cuotas', icon: 'wallet' },
    { path: '/admin/escuela', label: 'Escuela de tenis', short: 'Escuela', icon: 'school' },
    { path: '/admin/torneos', label: 'Torneos', icon: 'trophy' },
  ] },
  { group: 'Configuración', items: [
    { path: '/admin/canchas', label: 'Canchas', icon: 'court' },
    { path: '/admin/portal', label: 'Portal de jugadores', short: 'Portal', icon: 'portal' },
    { path: '/admin/configuracion', label: 'Configuración del club', short: 'Ajustes', icon: 'settings' },
  ] },
]
const ALL_ITEMS = ADMIN_NAV.flatMap((group) => group.items)

export function AdminShell({ route, navigate, children }: { route: RoutePath; navigate: (path: RoutePath) => void; children: ReactNode }) {
  const [intent, setIntent] = useState<ReservationIntent | null>(null)
  const [sheet, setSheet] = useState<'none' | 'create' | 'more' | 'account'>('none')
  const [accountOpen, setAccountOpen] = useState(false)
  const { state, dispatch } = useStore()
  const scrolled = useScrolled()
  const current = ALL_ITEMS.find((item) => item.path === route)

  const value = useMemo(() => {
    const go = (path: RoutePath) => { setSheet('none'); setAccountOpen(false); navigate(path) }
    return {
      go,
      goWith: (path: RoutePath, next: Intent) => { dispatch({ type: 'intent/set', intent: next }); go(path) },
      openReservation: (next: ReservationIntent) => { setSheet('none'); setIntent(next) },
    }
  }, [navigate, dispatch])

  return (
    <AdminContext.Provider value={value}>
      <div className="admin-shell">
        <a className="skip-link" href="#contenido">Saltar al contenido</a>
        <aside className="sidebar" aria-label="Navegación principal">
          <div className="sidebar-brand">
            <Crest size={44} />
            <div className="sidebar-brand-text">
              <strong className="display">{state.club.name}</strong>
              <span>{state.club.city}</span>
            </div>
          </div>
          <nav className="sidebar-nav">
            {ADMIN_NAV.map((group) => (
              <div key={group.group} className="sidebar-group">
                <p className="sidebar-group-label">{group.group}</p>
                {group.items.map((item) => (
                  <button key={item.path} type="button" className={`sidebar-link ${route === item.path ? 'is-active' : ''}`} aria-current={route === item.path ? 'page' : undefined} onClick={() => value.go(item.path)}>
                    <Icon name={item.icon} size={22} />
                    <span className="sidebar-link-label">{item.label}</span>
                    <span className="sidebar-link-short">{item.short ?? item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <AccountMenu open={accountOpen} setOpen={setAccountOpen} go={value.go} />
        </aside>

        <div className="admin-main">
          <header className={`topbar ${scrolled ? 'is-condensed' : ''}`}>
            <h1 className="visually-hidden">{current?.label ?? 'Inicio'} · {state.club.name}</h1>
            <ClubClock />
            <button type="button" className="topbar-crest" onClick={() => value.go('/admin/inicio')} aria-label={`${state.club.name}, ir al inicio`}>
              <span className="topbar-crest-plinth" aria-hidden="true" />
              <Crest size={60} />
            </button>
            <div className="topbar-actions">
              <Button variant="secondary" icon="cart" onClick={() => value.go('/admin/cantina')} className="hide-mobile">Venta rápida</Button>
              <Button variant="accent" icon="plus" onClick={() => value.openReservation({ date: TODAY })} className="hide-mobile">Nueva reserva</Button>
              <IconButton icon="settings" label="Configuración del club" variant="on-dark" className={`show-mobile ${route === '/admin/configuracion' ? 'is-current' : ''}`} onClick={() => value.go('/admin/configuracion')} />
              <button type="button" className="topbar-avatar show-mobile" aria-label="Cuenta" aria-haspopup="dialog" onClick={() => setSheet('account')}>
                <Avatar name="Rafael Ibarra" size="sm" />
              </button>
            </div>
          </header>
          <main id="contenido" className="admin-content" tabIndex={-1}>
            {children}
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Accesos principales">
          {ALL_ITEMS.slice(0, 2).map((item) => <BottomLink key={item.path} item={item} active={route === item.path} onClick={() => value.go(item.path)} />)}
          <button type="button" className="bottom-fab" aria-label="Crear" aria-haspopup="dialog" onClick={() => setSheet('create')}>
            <span><Icon name="plus" size={28} /></span>
          </button>
          <BottomLink item={ALL_ITEMS[2]} active={route === ALL_ITEMS[2].path} onClick={() => value.go(ALL_ITEMS[2].path)} />
          <button type="button" className={`bottom-link ${ALL_ITEMS.slice(3).some((item) => item.path === route) ? 'is-active' : ''}`} aria-haspopup="dialog" onClick={() => setSheet('more')}>
            <Icon name="grid" size={22} />
            <span>Más</span>
          </button>
        </nav>

        <Modal open={sheet === 'create'} onClose={() => setSheet('none')} title="Crear" size="sm">
          <div className="tile-grid">
            <ActionTile icon="calendar" label="Nueva reserva" tone="accent" onClick={() => value.openReservation({ date: TODAY })} />
            <ActionTile icon="cart" label="Venta rápida" onClick={() => value.go('/admin/cantina')} />
            <ActionTile icon="lock" label="Bloquear cancha" onClick={() => value.openReservation({ date: TODAY, mode: 'block' })} />
            <ActionTile icon="school" label="Nueva clase" onClick={() => value.goWith('/admin/escuela', { kind: 'newLesson' })} />
            <ActionTile icon="userPlus" label="Nuevo jugador" onClick={() => value.goWith('/admin/jugadores', { kind: 'newPlayer' })} />
            <ActionTile icon="wallet" label="Registrar pago" onClick={() => value.goWith('/admin/cuotas', { kind: 'pay' })} />
          </div>
        </Modal>
        <Modal open={sheet === 'more'} onClose={() => setSheet('none')} title="Más secciones" size="sm">
          <div className="tile-grid">
            {ALL_ITEMS.slice(3).map((item) => <ActionTile key={item.path} icon={item.icon} label={item.label} active={route === item.path} onClick={() => value.go(item.path)} />)}
          </div>
        </Modal>
        <Modal open={sheet === 'account'} onClose={() => setSheet('none')} title="Cuenta" size="sm">
          <AccountContent go={value.go} />
        </Modal>

        <ReservationSheet intent={intent} onClose={() => setIntent(null)} />
      </div>
    </AdminContext.Provider>
  )
}

function BottomLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`bottom-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon name={item.icon} size={22} />
      <span>{item.short ?? item.label}</span>
    </button>
  )
}

function ActionTile({ icon, label, onClick, tone, active }: { icon: IconName; label: string; onClick: () => void; tone?: 'accent'; active?: boolean }) {
  return (
    <button type="button" className={`action-tile ${tone === 'accent' ? 'is-accent' : ''} ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="action-tile-icon"><Icon name={icon} size={24} /></span>
      <span>{label}</span>
    </button>
  )
}

function AccountContent({ go }: { go: (path: RoutePath) => void }) {
  return (
    <div className="account">
      <div className="account-id">
        <Avatar name="Rafael Ibarra" size="lg" />
        <div>
          <strong>Rafael Ibarra</strong>
          <span>rafa@club.test · Propietario</span>
        </div>
      </div>
      <div className="account-actions">
        <button type="button" className="menu-item" onClick={() => go('/jugador/inicio')}><Icon name="swap" />Ver como jugador</button>
        <button type="button" className="menu-item" onClick={() => go('/admin/configuracion')}><Icon name="settings" />Configuración del club</button>
        <button type="button" className="menu-item" onClick={() => go('/sistema')}><Icon name="layers" />Design system</button>
        <button type="button" className="menu-item" onClick={() => go('/acceso')}><Icon name="logout" />Cerrar sesión <span className="menu-item-note">simulado</span></button>
      </div>
    </div>
  )
}

function AccountMenu({ open, setOpen, go }: { open: boolean; setOpen: (open: boolean) => void; go: (path: RoutePath) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])
  return (
    <div className="sidebar-account" ref={ref}>
      {open && <div className="popover" role="menu"><AccountContent go={go} /></div>}
      <button type="button" className="sidebar-account-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <Avatar name="Rafael Ibarra" size="sm" />
        <span className="sidebar-account-text"><strong>Rafael</strong><span>Propietario</span></span>
        <Icon name="chevronDown" size={16} />
      </button>
    </div>
  )
}

/** Fecha y hora del club: discreta en el header (la hora es simulada en el prototipo). */
function ClubClock() {
  return (
    <p className="topbar-clock" aria-label={`Hoy, ${dayLong(TODAY)}, ${hhmm(NOW)} hora del club`}>
      <span className="topbar-clock-day" aria-hidden="true">
        <span className="hide-mobile">{capitalize(dayLong(TODAY))}</span>
        <span className="show-mobile">{capitalize(weekdayShort(TODAY))} {dateShort(TODAY)}</span>
      </span>
      <span className="topbar-clock-time num" aria-hidden="true"><i />{hhmm(NOW)}</span>
    </p>
  )
}
