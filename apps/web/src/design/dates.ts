/*
 * Formato de fechas ISO (AAAA-MM-DD) y de minutos del día para las pantallas integradas.
 * Solo presentación: las reglas de horario y la zona del club viven en features/reservations/reservationUtils.
 */
const parse = (iso: string) => new Date(`${iso}T12:00:00`)
const capitalizeText = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const capitalize = capitalizeText
export const dateShort = (iso: string) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(parse(iso)).replace('.', '')
export const dayNumber = (iso: string) => parse(iso).getDate()
export const weekdayShort = (iso: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(parse(iso)).replace('.', '')
export const dayLong = (iso: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(parse(iso))
export const monthLong = (iso: string) => new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(parse(iso))

export function addDays(iso: string, days: number): string {
  const date = parse(iso)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Lunes de la semana de `iso`. */
export const weekStart = (iso: string) => addDays(iso, -((parse(iso).getDay() + 6) % 7))

/** Minutos desde medianoche de un horario HH:MM (acepta HH:MM:SS). */
export function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
