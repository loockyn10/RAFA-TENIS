import { useSyncExternalStore } from 'react'

const supportsMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (!supportsMatchMedia()) return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', callback)
      return () => list.removeEventListener('change', callback)
    },
    () => (supportsMatchMedia() ? window.matchMedia(query).matches : false),
    () => false,
  )
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)')
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

/** true cuando la página se desplazó más allá del umbral (header condensado). */
export function useScrolled(threshold = 12): boolean {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener('scroll', callback, { passive: true })
      return () => window.removeEventListener('scroll', callback)
    },
    () => window.scrollY > threshold,
    () => false,
  )
}
