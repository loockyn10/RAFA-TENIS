export function bracketSize(entryCount: number) {
  if (entryCount < 2 || entryCount > 32) throw new Error('El fixture admite entre 2 y 32 inscripciones.')
  let size = 2
  while (size < entryCount) size *= 2
  return size
}

/** Distribuye los pases libres sin crear un enfrentamiento vacío. La migración aplica este mismo esquema atómicamente. */
export function firstRoundPlan<T>(entries: T[]) {
  const size = bracketSize(entries.length)
  const pairCount = size / 2
  const fullPairCount = entries.length - pairCount
  let cursor = 0
  return Array.from({ length: pairCount }, (_, index) => {
    const first = entries[cursor++]
    const second = index < fullPairCount ? entries[cursor++] : null
    return [first, second] as const
  })
}
