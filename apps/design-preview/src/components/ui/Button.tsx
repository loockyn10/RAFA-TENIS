import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'accent' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-dark'
export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
  children?: ReactNode
}

/**
 * accent = acción principal de la pantalla (amarillo pelota, una por vista).
 * primary = confirmar dentro de formularios. secondary/ghost = alternativas. on-dark = sobre superficies verdes.
 */
export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading = false, block = false, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, block ? 'btn-block' : '', loading ? 'is-loading' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'lg' ? 22 : 18} />}
      {children && <span className="btn-label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={18} />}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: 'ghost' | 'secondary' | 'on-dark'; size?: 'sm' | 'md' }

export function IconButton({ icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`icon-btn icon-btn-${variant} icon-btn-${size} ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 18 : 20} />
    </button>
  )
}
