import { useCallback, useSyncExternalStore } from 'react'

export type RoutePath =
  | '/admin/inicio' | '/admin/reservas' | '/admin/cantina'
  | '/admin/jugadores' | '/admin/cuotas' | '/admin/escuela' | '/admin/torneos' | '/admin/canchas' | '/admin/portal' | '/admin/configuracion'
  | '/jugador/inicio' | '/jugador/reservar' | '/jugador/turnos' | '/jugador/torneos' | '/jugador/perfil'
  | '/acceso'
  | '/sistema'

const DEFAULT_ROUTE: RoutePath = '/admin/inicio'

function read(): RoutePath {
  const hash = window.location.hash.replace(/^#/, '')
  return (hash.startsWith('/') ? hash : DEFAULT_ROUTE) as RoutePath
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

/** Router mínimo por hash: el prototipo no agrega dependencias de routing. */
export function useRoute(): [RoutePath, (path: RoutePath) => void] {
  const path = useSyncExternalStore(subscribe, read, () => DEFAULT_ROUTE)
  const navigate = useCallback((next: RoutePath) => {
    if (read() !== next) window.location.hash = next
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])
  return [path, navigate]
}
