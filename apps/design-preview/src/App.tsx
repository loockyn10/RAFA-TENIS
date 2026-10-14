import { Providers } from './components/Providers'
import { AdminShell } from './components/shell/AdminShell'
import { PlayerShell } from './components/shell/PlayerShell'
import { ProtoPanel } from './components/shell/ProtoPanel'
import { useRoute } from './lib/router'
import { AdminHome } from './screens/admin/AdminHome'
import { Canteen } from './screens/admin/Canteen'
import { Courts } from './screens/admin/Courts'
import { Dues } from './screens/admin/Dues'
import { Invitations } from './screens/admin/Invitations'
import { Players } from './screens/admin/Players'
import { Reservations } from './screens/admin/Reservations'
import { School } from './screens/admin/School'
import { Settings } from './screens/admin/Settings'
import { Tournaments } from './screens/admin/Tournaments'
import { Access } from './screens/auth/Access'
import { PlayerBook, PlayerHome, PlayerProfile, PlayerTournaments, PlayerTurns } from './screens/player/PlayerScreens'
import { SystemScreen } from './screens/SystemScreen'

export function App() {
  return (
    <Providers>
      <Router />
    </Providers>
  )
}

function adminScreen(route: string) {
  switch (route) {
    case '/admin/reservas': return <Reservations />
    case '/admin/cantina': return <Canteen />
    case '/admin/jugadores': return <Players />
    case '/admin/cuotas': return <Dues />
    case '/admin/escuela': return <School />
    case '/admin/torneos': return <Tournaments />
    case '/admin/canchas': return <Courts />
    case '/admin/portal': return <Invitations />
    case '/admin/configuracion': return <Settings />
    default: return <AdminHome />
  }
}

function Router() {
  const [route, navigate] = useRoute()

  let screen
  if (route === '/sistema') {
    screen = <SystemScreen go={navigate} />
  } else if (route === '/acceso') {
    screen = <Access go={navigate} />
  } else if (route.startsWith('/jugador')) {
    screen = (
      <PlayerShell route={route} navigate={navigate}>
        {route === '/jugador/reservar' ? <PlayerBook go={navigate} />
          : route === '/jugador/turnos' ? <PlayerTurns go={navigate} />
            : route === '/jugador/torneos' ? <PlayerTournaments />
              : route === '/jugador/perfil' ? <PlayerProfile />
                : <PlayerHome go={navigate} />}
      </PlayerShell>
    )
  } else {
    screen = <AdminShell route={route} navigate={navigate}>{adminScreen(route)}</AdminShell>
  }

  return (
    <>
      {screen}
      <ProtoPanel route={route} navigate={navigate} />
    </>
  )
}
