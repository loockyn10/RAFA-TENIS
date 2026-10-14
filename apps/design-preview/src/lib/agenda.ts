import type { Occupation } from '../data/mock'
import { DAY_CLOSE, overlaps, type Minutes } from './time'

export type SlotDraft = { courtId: string; date: string; start: Minutes; end: Minutes }

/** Prechequeo de UI. En la app real la exclusión GiST de PostgreSQL es la garantía final. */
export function findConflict(list: Occupation[], draft: SlotDraft, ignoreId?: string): Occupation | undefined {
  return list.find((item) => item.id !== ignoreId && item.courtId === draft.courtId && item.date === draft.date && overlaps(item, draft))
}

export function forDay(list: Occupation[], date: string, courtId?: string): Occupation[] {
  return list
    .filter((item) => item.date === date && (courtId === undefined || item.courtId === courtId))
    .sort((a, b) => a.start - b.start)
}

export function occupationAt(list: Occupation[], courtId: string, date: string, at: Minutes): Occupation | undefined {
  return list.find((item) => item.courtId === courtId && item.date === date && item.start <= at && at < item.end)
}

export function nextStartAfter(list: Occupation[], courtId: string, date: string, at: Minutes): Minutes {
  const next = forDay(list, date, courtId).find((item) => item.start >= at)
  return next ? next.start : DAY_CLOSE
}

export function busyMinutes(list: Occupation[], courtId: string, date: string, from: Minutes, to: Minutes): number {
  return forDay(list, date, courtId).reduce((sum, item) => sum + Math.max(0, Math.min(item.end, to) - Math.max(item.start, from)), 0)
}
