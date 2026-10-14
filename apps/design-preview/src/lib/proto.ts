import { createContext, useContext } from 'react'

/** Estado simulado de datos para revisar vacíos, carga y errores sin backend. */
export type DataState = 'ok' | 'loading' | 'empty' | 'error'
export type ToastTone = 'success' | 'error' | 'info'
export type Toast = { id: number; tone: ToastTone; title: string; body?: string }

export type ProtoValue = {
  dataState: DataState
  setDataState: (state: DataState) => void
  failActions: boolean
  setFailActions: (value: boolean) => void
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  /** Simula latencia de red; rechaza si «Simular fallo» está activo. */
  simulate: (ms?: number) => Promise<void>
}

export const ProtoContext = createContext<ProtoValue | null>(null)

export function useProto() {
  const value = useContext(ProtoContext)
  if (!value) throw new Error('useProto fuera de ProtoProvider')
  return value
}

/** Estado de datos de una pantalla + reintento simulado (carga breve y vuelta a normal). */
export function useScreenState() {
  const { dataState, setDataState } = useProto()
  const retry = () => {
    setDataState('loading')
    window.setTimeout(() => setDataState('ok'), 900)
  }
  return { dataState, retry }
}
