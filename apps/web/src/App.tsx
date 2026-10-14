import { AuthProvider, useAuth } from './auth/AuthProvider'
import type { ReactNode } from 'react'
import { LoginScreen } from './auth/LoginScreen'
import { AccessRouter } from './auth/AccessRouter'
import { supabase, supabaseConfiguration } from './lib/supabase'

function AppContent() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return <AppFrame><p className="screen-message" role="status">Verificando tu sesión…</p></AppFrame>
  }

  if (user === null) {
    return <AppFrame><LoginScreen /></AppFrame>
  }

  return <AppFrame><AccessRouter user={user} /></AppFrame>
}


function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
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

function ConfigurationPending() {
  return (
    <AppFrame>
      <section className="configuration-card" aria-labelledby="configuration-title">
        <p className="eyebrow">Configuración pendiente</p>
        <h1 id="configuration-title">Conectá Rafa Tenis con Supabase.</h1>
        <p className="intro">La aplicación está lista, pero necesita sus variables públicas de conexión antes de habilitar el acceso administrativo.</p>
        <ul>
          {supabaseConfiguration.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
        <p className="subtle-copy">Configurá <code>.env.local</code> a partir de <code>.env.example</code>. No incluyas claves de servicio en el navegador.</p>
      </section>
    </AppFrame>
  )
}

function App() {
  if (supabase === null) {
    return <ConfigurationPending />
  }

  return <AuthProvider client={supabase}><AppContent /></AuthProvider>
}

export { AppContent, AppFrame }
export default App
