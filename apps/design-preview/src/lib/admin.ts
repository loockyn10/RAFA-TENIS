import { createContext, useContext } from 'react'
import type { ReservationIntent } from '../screens/admin/ReservationSheet'
import type { RoutePath } from './router'
import type { Intent } from './store'

export type AdminValue = {
  go: (path: RoutePath) => void
  /** Navega y deja un pedido de contexto (abrir ficha, formulario, clase o partido) para la pantalla destino. */
  goWith: (path: RoutePath, intent: Intent) => void
  openReservation: (intent: ReservationIntent) => void
}

export const AdminContext = createContext<AdminValue | null>(null)

export function useAdmin() {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdmin fuera de AdminShell')
  return value
}
