import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginScreen } from './auth/LoginScreen'
import { AccessRouter } from './auth/AccessRouter'
import { AppFrame } from './auth/AppFrame'
import { supabase, supabaseConfiguration } from './lib/supabase'

function AppContent() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return <AppFrame><p className="screen-message" role="status">Verificando tu sesión…</p></AppFrame>
  }

  if (user === null) {
    return <AppFrame><LoginScreen /></AppFrame>
  }

  return <AccessRouter user={user} />
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

export { AppContent }
export default App
