import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginScreen } from './auth/LoginScreen'
import { AccessRouter } from './auth/AccessRouter'
import { AuthLayout, AuthLoading, AuthNotice } from './auth/AuthLayout'
import { supabase, supabaseConfiguration } from './lib/supabase'

function AppContent() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return <AuthLoading message="Verificando tu sesión…" />
  }

  if (user === null) {
    return <LoginScreen />
  }

  return <AccessRouter user={user} />
}


function ConfigurationPending() {
  return (
    <AuthLayout>
      <AuthNotice kicker="Configuración pendiente" title="Conectá Rafa Tenis con Supabase.">
        <div>
          <p>La aplicación está lista, pero necesita sus variables públicas de conexión antes de habilitar el acceso.</p>
          <ul className="config-issues">
            {supabaseConfiguration.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
          <p className="muted">Configurá <code>.env.local</code> a partir de <code>.env.example</code>. No incluyas claves de servicio en el navegador.</p>
        </div>
      </AuthNotice>
    </AuthLayout>
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
