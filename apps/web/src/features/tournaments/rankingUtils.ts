import type { SupabaseClient } from '@supabase/supabase-js'

// Ranking interno del club. Los puntos NO se calculan ni se guardan acá: los entrega PostgreSQL (`club_ranking`,
// `club_ranking_player_detail`) a partir de los resultados de torneos. Este archivo solo valida y rotula esa respuesta.

export type RankingModality = 'singles' | 'doubles'
export type RankingResultKind = 'champion' | 'finalist' | 'semifinal' | 'quarterfinal' | 'round_of_16' | 'participant'

export type RankingRow = { position: number; person_id: string; name: string; points: number; tournaments: number; titles: number; runner_ups: number }
export type RankingData = { season: number; seasons: number[]; modality: RankingModality; my_person_id: string | null; rows: RankingRow[] }
export type RankingDetailItem = { tournament_id: string; tournament_name: string; category_id: string; category_name: string; entry_name: string; ends_on: string; result: RankingResultKind; points: number }

export const MODALITY_LABEL: Record<RankingModality, string> = { singles: 'Singles', doubles: 'Dobles' }

export const RESULT_LABEL: Record<RankingResultKind, string> = {
  champion: 'Campeón', finalist: 'Finalista', semifinal: 'Semifinalista', quarterfinal: 'Cuartofinalista', round_of_16: 'Octavos de final', participant: 'Participó',
}

/** Escala vigente, solo para explicarla en pantalla (la fuente de verdad es la función SQL). */
export const POINTS_SCALE: { result: RankingResultKind; points: number }[] = [
  { result: 'champion', points: 100 }, { result: 'finalist', points: 60 }, { result: 'semifinal', points: 35 }, { result: 'quarterfinal', points: 15 }, { result: 'round_of_16', points: 5 },
]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

function parseRow(value: unknown): RankingRow | null {
  if (!isRecord(value)) return null
  const { position, person_id, name, points, tournaments, titles, runner_ups } = value
  if (!isInt(position) || typeof person_id !== 'string' || typeof name !== 'string' || !isInt(points) || !isInt(tournaments) || !isInt(titles) || !isInt(runner_ups)) return null
  return { position, person_id, name, points, tournaments, titles, runner_ups }
}

/** Valida la respuesta del servidor; si no tiene la forma esperada devuelve null (la pantalla muestra un error, no datos inventados). */
export function parseRanking(value: unknown): RankingData | null {
  if (!isRecord(value) || !isInt(value.season) || !Array.isArray(value.seasons) || !Array.isArray(value.rows)) return null
  if (value.modality !== 'singles' && value.modality !== 'doubles') return null
  const rows = value.rows.map(parseRow)
  if (rows.some((row) => row === null)) return null
  return {
    season: value.season,
    seasons: value.seasons.filter(isInt),
    modality: value.modality,
    my_person_id: typeof value.my_person_id === 'string' ? value.my_person_id : null,
    rows: rows as RankingRow[],
  }
}

export function parseRankingDetail(value: unknown): RankingDetailItem[] | null {
  if (!Array.isArray(value)) return null
  const items: RankingDetailItem[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.tournament_id !== 'string' || typeof item.tournament_name !== 'string' || typeof item.category_id !== 'string' || typeof item.category_name !== 'string'
      || typeof item.entry_name !== 'string' || typeof item.ends_on !== 'string' || !isInt(item.points) || typeof item.result !== 'string' || !(item.result in RESULT_LABEL)) return null
    items.push({ tournament_id: item.tournament_id, tournament_name: item.tournament_name, category_id: item.category_id, category_name: item.category_name, entry_name: item.entry_name, ends_on: item.ends_on, result: item.result as RankingResultKind, points: item.points })
  }
  return items
}

/** Temporadas para el selector: las que tienen datos más la que se está mostrando (puede estar vacía), de la más reciente a la más antigua. */
export function seasonOptions(data: Pick<RankingData, 'season' | 'seasons'>): number[] {
  return Array.from(new Set([...data.seasons, data.season])).sort((a, b) => b - a)
}

export const tournamentsLabel = (count: number) => `${count} ${count === 1 ? 'torneo' : 'torneos'}`
export const titlesLabel = (count: number) => `${count} ${count === 1 ? 'ganado' : 'ganados'}`

export async function fetchRanking(client: SupabaseClient, clubId: string, season: number | null, modality: RankingModality): Promise<RankingData | null> {
  const { data, error } = await client.rpc('club_ranking', { p_club_id: clubId, p_season: season, p_modality: modality })
  return error ? null : parseRanking(data)
}

export async function fetchRankingDetail(client: SupabaseClient, clubId: string, season: number, modality: RankingModality, personId: string): Promise<RankingDetailItem[] | null> {
  const { data, error } = await client.rpc('club_ranking_player_detail', { p_club_id: clubId, p_season: season, p_modality: modality, p_person_id: personId })
  return error ? null : parseRankingDetail(data)
}
