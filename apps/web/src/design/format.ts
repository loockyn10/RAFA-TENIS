export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Centavos → texto editable en un campo de importe («35.000» / «35.000,50»). */
export function moneyInputValue(cents: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(cents / 100)
}

/** Texto de búsqueda sin tildes ni mayúsculas, para filtrar listas locales. */
export const normalizeSearch = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
