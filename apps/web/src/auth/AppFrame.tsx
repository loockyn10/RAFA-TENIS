import type { ReactNode } from 'react'

/** Marco de las pantallas todavía no integradas al nuevo shell (login, portal del jugador, canje). Usa el CSS previo. */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell legacy-scope">
      <header className="site-header">
        <a className="brand" href="#inicio" aria-label="Rafa Tenis, inicio">
          <img className="brand-mark" src="/branding/logoRafa.png" alt="" />
          <span>Rafa Tenis</span>
        </a>
      </header>
      <main id="inicio">{children}</main>
      <footer><span>Rafa Tenis</span><span>Gestión del club · Argentina</span></footer>
    </div>
  )
}
