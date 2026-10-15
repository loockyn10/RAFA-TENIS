import type { ReactNode } from 'react'
import { Button, Crest, Icon } from '../design/ui'

/**
 * Marco de las pantallas previas al shell (acceso, canje, estados sin acceso, configuración pendiente).
 * Panel de marca + tarjeta, igual que el prototipo, sin datos ficticios.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="rt rt-app">
      <div className="auth">
        <aside className="auth-brand texture-court">
          <div className="auth-brand-inner">
            <Crest size={112} className="auth-crest" />
            <p className="kicker kicker-on-dark">Gestión del club · Argentina</p>
            <p className="display auth-brand-name">Rafa Tenis</p>
            <p className="auth-tagline">Reservá cancha, seguí tus torneos y tus cuotas desde el celular.</p>
            <ul className="auth-points" aria-label="Qué podés hacer">
              <li><Icon name="calendar" size={18} />Turnos en segundos</li>
              <li><Icon name="trophy" size={18} />Cuadros y partidos</li>
              <li><Icon name="wallet" size={18} />Estado de cuotas</li>
            </ul>
          </div>
        </aside>
        <main className="auth-main" id="contenido">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    </div>
  )
}

/** Mensaje de estado dentro del marco de acceso (cargando, error, sin acceso). */
export function AuthNotice({ kicker, title, children, tone = 'info', action }: { kicker?: string; title: string; children?: ReactNode; tone?: 'info' | 'error'; action?: ReactNode }) {
  return (
    <section className="auth-step" aria-labelledby="auth-notice-title">
      {kicker && <p className="kicker">{kicker}</p>}
      <h1 id="auth-notice-title" className="display auth-title">{title}</h1>
      {children && <div className={tone === 'error' ? 'inline-alert inline-alert-danger' : 'muted'} role={tone === 'error' ? 'alert' : undefined}>{children}</div>}
      {action}
    </section>
  )
}

/** Pantalla de carga con la misma tarjeta que el resto del acceso. */
export function AuthLoading({ message }: { message: string }) {
  return (
    <AuthLayout>
      <section className="auth-step" role="status" aria-live="polite">
        <p className="muted">{message}</p>
      </section>
    </AuthLayout>
  )
}

/** Cierre de sesión reutilizable en las pantallas sin club. */
export function SignOutButton({ onSignOut, busy }: { onSignOut: () => void; busy?: boolean }) {
  return <Button variant="secondary" icon="logout" onClick={onSignOut} disabled={busy}>{busy ? 'Cerrando…' : 'Cerrar sesión'}</Button>
}
