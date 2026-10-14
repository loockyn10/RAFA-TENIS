import type { ReactNode } from 'react'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Modal } from './Modal'

type ConfirmProps = {
  open: boolean
  title: ReactNode
  children?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary' | 'accent'
  icon?: IconName
  status: 'idle' | 'saving' | 'error'
  errorTitle?: string
  errorBody?: string
  disabled?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Confirmación con envío simulado: bloquea el cierre mientras guarda y ofrece reintento sin duplicar. */
export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'danger', icon = 'check', status, errorTitle = 'No se pudo completar', errorBody = 'No cambió nada. Probá de nuevo.', disabled, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      busy={status === 'saving'}
      title={title}
      footer={
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={status === 'saving'}>Volver</Button>
          <Button variant={tone} icon={status === 'error' ? 'refresh' : icon} loading={status === 'saving'} disabled={disabled} onClick={onConfirm} data-autofocus>
            {status === 'error' ? 'Reintentar' : confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="confirm-body">
        {children}
        {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>{errorTitle}</strong><p>{errorBody}</p></div></div>}
      </div>
    </Modal>
  )
}
