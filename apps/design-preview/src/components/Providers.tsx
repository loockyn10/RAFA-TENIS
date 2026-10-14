import { useCallback, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { ProtoContext, useProto, type DataState, type Toast } from '../lib/proto'
import { initialState, reducer, StoreContext } from '../lib/store'
import { Icon, IconButton } from './ui'

export function Providers({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [dataState, setDataState] = useState<DataState>('ok')
  const [failActions, setFailActions] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const failRef = useRef(failActions)
  failRef.current = failActions

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-2), { ...toast, id }])
    window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 7000 : 4200)
  }, [dismiss])
  const simulate = useCallback((ms = 750) => new Promise<void>((resolve, reject) => {
    window.setTimeout(() => (failRef.current ? reject(new Error('Fallo simulado')) : resolve()), ms)
  }), [])

  const proto = useMemo(() => ({ dataState, setDataState, failActions, setFailActions, toasts, notify, dismiss, simulate }), [dataState, failActions, toasts, notify, dismiss, simulate])
  const store = useMemo(() => ({ state, dispatch }), [state])

  return (
    <ProtoContext.Provider value={proto}>
      <StoreContext.Provider value={store}>
        {children}
        <ToastRegion />
      </StoreContext.Provider>
    </ProtoContext.Provider>
  )
}

function ToastRegion() {
  const { toasts, dismiss } = useProto()
  return (
    <div className="toast-region" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={toast.tone === 'success' ? 'checkCircle' : toast.tone === 'error' ? 'alert' : 'info'} size={22} />
          <div className="toast-text">
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
          </div>
          <IconButton icon="x" label="Cerrar aviso" size="sm" onClick={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>
  )
}
