import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  /** dialog: centrado en escritorio. drawer: panel lateral en escritorio. En celular ambos son hoja inferior. */
  variant?: 'dialog' | 'drawer'
  size?: 'sm' | 'md' | 'lg'
  footer?: ReactNode
  children: ReactNode
  /** Evita cerrar con fondo/Escape durante un envío. */
  busy?: boolean
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Pila de diálogos abiertos: solo el de arriba responde a Escape y atrapa el foco. */
const stack: symbol[] = []

export function Modal({ open, onClose, title, eyebrow, variant = 'dialog', size = 'md', footer, children, busy = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const token = Symbol('modal')
    stack.push(token)
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== token) return
      if (event.key === 'Escape' && !busyRef.current) {
        event.stopPropagation()
        onCloseRef.current()
      }
      if (event.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (nodes.length === 0) return
        const firstNode = nodes[0]
        const lastNode = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === firstNode) { event.preventDefault(); lastNode.focus() }
        else if (!event.shiftKey && document.activeElement === lastNode) { event.preventDefault(); firstNode.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      stack.splice(stack.indexOf(token), 1)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className={`rt modal-root modal-${variant}`}>
      <div className="modal-backdrop" onClick={() => { if (!busy) onClose() }} aria-hidden="true" />
      <div ref={panelRef} className={`modal-panel modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="modal-header">
          <div>
            {eyebrow && <p className="kicker">{eyebrow}</p>}
            <h2 id={titleId} className="modal-title">{title}</h2>
          </div>
          <IconButton icon="x" label="Cerrar" onClick={onClose} disabled={busy} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
