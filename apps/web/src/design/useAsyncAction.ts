import { useCallback, useRef, useState } from 'react'

/**
 * Estado de una operación de guardado (reemplaza al `useAction` simulado del prototipo).
 * `run` ejecuta la operación real y la bloquea mientras está en curso (un doble clic no la envía dos veces).
 * La función devuelve `null` si salió bien o el mensaje de error; si lanza una excepción se informa un error genérico.
 */
export type ActionStatus = 'idle' | 'saving' | 'error'

export function useAsyncAction() {
  const [status, setStatus] = useState<ActionStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const sending = useRef(false)

  const run = useCallback(async (operation: () => Promise<string | null | void>): Promise<boolean> => {
    if (sending.current) return false
    sending.current = true
    setStatus('saving')
    setMessage(null)
    try {
      const error = await operation()
      if (error) { setStatus('error'); setMessage(error); return false }
      setStatus('idle')
      return true
    } catch {
      setStatus('error')
      setMessage('No pudimos completar la operación. Intentá nuevamente.')
      return false
    } finally {
      sending.current = false
    }
  }, [])

  const reset = useCallback(() => { setStatus('idle'); setMessage(null) }, [])

  return { status, message, saving: status === 'saving', failed: status === 'error', run, reset }
}
