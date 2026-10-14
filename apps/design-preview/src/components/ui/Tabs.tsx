import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: IconName; count?: number }

/** Control segmentado accesible (tablist) con navegación por flechas. */
export function SegmentedTabs<T extends string>({ items, value, onChange, label, size = 'md', stretch = false }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; size?: 'sm' | 'md'; stretch?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    onChange(items[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div className={`segmented segmented-${size} ${stretch ? 'segmented-stretch' : ''}`} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(node) => { refs.current[index] = node }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'is-selected' : ''}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon && <Icon name={item.icon} size={16} />}
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 && <span className="segmented-count">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
