import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar, Button, Crest, Field, Icon, IconButton, Modal, SelectInput, type IconName } from '../../design/ui'
import { useScrolled } from '../../design/media'
import type { Club, ClubRole } from '../../types/domain'
import { roleLabel } from './roleLabel'

export type AdminSection = 'home' | 'reservations' | 'canteen' | 'people' | 'fees' | 'school' | 'tournaments' | 'courts' | 'settings' | 'playerAccess'

type NavItem = { section: AdminSection; label: string; short?: string; icon: IconName; managersOnly?: boolean }
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: 'Operación', items: [
    { section: 'home', label: 'Inicio', icon: 'home' },
    { section: 'reservations', label: 'Reservas', icon: 'calendar' },
    { section: 'canteen', label: 'Cantina', icon: 'cart' },
  ] },
  { group: 'Club', items: [
    { section: 'people', label: 'Jugadores', icon: 'users' },
    { section: 'fees', label: 'Cuotas', icon: 'wallet', managersOnly: true },
    { section: 'school', label: 'Escuela de tenis', short: 'Escuela', icon: 'school' },
    { section: 'tournaments', label: 'Torneos', icon: 'trophy' },
  ] },
  { group: 'Configuración', items: [
    { section: 'courts', label: 'Canchas', icon: 'court' },
    { section: 'settings', label: 'Configuración del club', short: 'Ajustes', icon: 'settings', managersOnly: true },
    { section: 'playerAccess', label: 'Portal de jugadores', short: 'Portal', icon: 'portal', managersOnly: true },
  ] },
]


export type AdminShellProps = {
  section: AdminSection
  onNavigate: (section: AdminSection) => void
  club: Club
  clubs: Club[]
  onSelectClub: (clubId: string) => void
  role: ClubRole | undefined
  canManage: boolean
  userEmail: string
  onSignOut: () => void
  signingOut: boolean
  onOpenPlayerPortal?: () => void
  /** Operaciones reales: cada una abre el formulario o módulo existente. */
  onNewReservation: () => void
  onNewBlock: () => void
  onNewLesson: () => void
  onNewPerson: () => void
  children: ReactNode
}

/** Hora y fecha reales del club (zona del club, no la del dispositivo). */
function useClubClock(timezone: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const long = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const short = new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(now).replace('.', '')
  return { time, long, short }
}
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function AdminShell(props: AdminShellProps) {
  const { section, onNavigate, club, canManage, children } = props
  const [sheet, setSheet] = useState<'none' | 'create' | 'more' | 'account'>('none')
  const [accountOpen, setAccountOpen] = useState(false)
  const scrolled = useScrolled()
  const clock = useClubClock(club.timezone)
  const groups = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.managersOnly || canManage) })).filter((group) => group.items.length > 0)
  const items = groups.flatMap((group) => group.items)
  const current = items.find((item) => item.section === section)
  const moreItems = items.slice(3)

  const go = (next: AdminSection) => { setSheet('none'); setAccountOpen(false); onNavigate(next) }
  const act = (action: () => void) => () => { setSheet('none'); setAccountOpen(false); action() }

  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => { contentRef.current?.focus({ preventScroll: true }) }, [section])

  return (
    <div className="rt-app admin-shell">
      <a className="rt skip-link" href="#contenido">Saltar al contenido</a>
      <aside className="rt sidebar" aria-label="Navegación principal">
        <div className="sidebar-brand">
          <Crest size={44} />
          <div className="sidebar-brand-text">
            <strong className="display">{club.name}</strong>
            <span>Gestión del club</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Secciones administrativas">
          {groups.map((group) => (
            <div key={group.group} className="sidebar-group">
              <p className="sidebar-group-label">{group.group}</p>
              {group.items.map((item) => (
                <button key={item.section} type="button" className={`sidebar-link ${section === item.section ? 'is-active' : ''}`} aria-current={section === item.section ? 'page' : undefined} onClick={() => go(item.section)}>
                  <Icon name={item.icon} size={22} />
                  <span className="sidebar-link-label">{item.label}</span>
                  <span className="sidebar-link-short">{item.short ?? item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <AccountMenu {...props} open={accountOpen} setOpen={setAccountOpen} />
      </aside>

      <div className="admin-main">
        <header className={`rt topbar ${scrolled ? 'is-condensed' : ''}`}>
          <h1 className="visually-hidden">{current?.label ?? 'Inicio'} · {club.name}</h1>
          <p className="topbar-clock" aria-label={`Hoy, ${clock.long}, ${clock.time} hora del club`}>
            <span className="topbar-clock-day" aria-hidden="true">
              <span className="hide-mobile">{capitalize(clock.long)}</span>
              <span className="show-mobile">{capitalize(clock.short)}</span>
            </span>
            <span className="topbar-clock-time num" aria-hidden="true"><i />{clock.time}</span>
          </p>
          <button type="button" className="topbar-crest" onClick={() => go('home')} aria-label={`${club.name}, ir al inicio`}>
            <span className="topbar-crest-plinth" aria-hidden="true" />
            <Crest size={60} />
          </button>
          <div className="topbar-actions">
            <Button variant="secondary" icon="cart" onClick={() => go('canteen')} className="hide-mobile">Venta rápida</Button>
            <Button variant="accent" icon="plus" onClick={act(props.onNewReservation)} className="hide-mobile">Nueva reserva</Button>
            {canManage && <IconButton icon="settings" label="Configuración del club" variant="on-dark" className={`show-mobile ${section === 'settings' ? 'is-current' : ''}`} onClick={() => go('settings')} />}
            <button type="button" className="topbar-avatar show-mobile" aria-label="Cuenta" aria-haspopup="dialog" onClick={() => setSheet('account')}>
              <Avatar name={props.userEmail || 'Cuenta'} size="sm" />
            </button>
          </div>
        </header>
        <main id="contenido" className="shell-content" tabIndex={-1} ref={contentRef}>
          {children}
        </main>
      </div>

      <nav className="rt bottom-nav" aria-label="Accesos principales">
        {items.slice(0, 2).map((item) => <BottomLink key={item.section} item={item} active={section === item.section} onClick={() => go(item.section)} />)}
        <button type="button" className="bottom-fab" aria-label="Crear" aria-haspopup="dialog" onClick={() => setSheet('create')}>
          <span><Icon name="plus" size={28} /></span>
        </button>
        <BottomLink item={items[2]} active={section === items[2].section} onClick={() => go(items[2].section)} />
        <button type="button" className={`bottom-link ${moreItems.some((item) => item.section === section) ? 'is-active' : ''}`} aria-haspopup="dialog" onClick={() => setSheet('more')}>
          <Icon name="grid" size={22} />
          <span>Más</span>
        </button>
      </nav>

      <Modal open={sheet === 'create'} onClose={() => setSheet('none')} title="Crear" size="sm">
        <div className="tile-grid">
          <ActionTile icon="calendar" label="Nueva reserva" tone="accent" onClick={act(props.onNewReservation)} />
          <ActionTile icon="cart" label="Venta rápida" onClick={() => go('canteen')} />
          <ActionTile icon="lock" label="Bloquear cancha" onClick={act(props.onNewBlock)} />
          <ActionTile icon="school" label="Nueva clase" onClick={act(props.onNewLesson)} />
          <ActionTile icon="userPlus" label="Nuevo jugador" onClick={act(props.onNewPerson)} />
          {canManage && <ActionTile icon="wallet" label="Cuotas y pagos" onClick={() => go('fees')} />}
        </div>
      </Modal>
      <Modal open={sheet === 'more'} onClose={() => setSheet('none')} title="Más secciones" size="sm">
        <div className="tile-grid">
          {moreItems.map((item) => <ActionTile key={item.section} icon={item.icon} label={item.label} active={section === item.section} onClick={() => go(item.section)} />)}
        </div>
      </Modal>
      <Modal open={sheet === 'account'} onClose={() => setSheet('none')} title="Cuenta" size="sm">
        <AccountContent {...props} />
      </Modal>
    </div>
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

function AccountContent({ userEmail, role, clubs, club, onSelectClub, onOpenPlayerPortal, onSignOut, signingOut }: AdminShellProps) {
  return (
    <div className="account">
      <div className="account-id">
        <Avatar name={userEmail || 'Cuenta'} size="lg" />
        <div>
          <strong>{userEmail || 'Cuenta autenticada'}</strong>
          <span>{roleLabel(role)} · {club.name}</span>
        </div>
      </div>
      {clubs.length > 1 && (
        <Field label="Club">{(id) => (
          <SelectInput id={id} value={club.id} onChange={(event) => onSelectClub(event.target.value)}>
            {clubs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectInput>
        )}</Field>
      )}
      <div className="rt-account-actions">
        {onOpenPlayerPortal && <button type="button" className="menu-item" onClick={onOpenPlayerPortal}><Icon name="swap" />Mi portal de jugador</button>}
        <button type="button" className="menu-item" onClick={onSignOut} disabled={signingOut}><Icon name="logout" />{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</button>
      </div>
    </div>
  )
}

function AccountMenu(props: AdminShellProps & { open: boolean; setOpen: (open: boolean) => void }) {
  const { open, setOpen, userEmail, role } = props
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
      {open && <div className="popover" role="dialog" aria-label="Cuenta"><AccountContent {...props} /></div>}
      <button type="button" className="sidebar-account-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Avatar name={userEmail || 'Cuenta'} size="sm" />
        <span className="sidebar-account-text"><strong>Cuenta</strong><span>{roleLabel(role)}</span></span>
        <Icon name="chevronDown" size={16} />
      </button>
    </div>
  )
}

