import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchRanking, fetchRankingDetail, parseRanking, parseRankingDetail, seasonOptions, tournamentsLabel, titlesLabel } from './rankingUtils'

const row = { position: 1, person_id: 'p1', name: 'Ana Gómez', points: 160, tournaments: 2, titles: 1, runner_ups: 1 }
const payload = { season: 2026, seasons: [2026, 2025], modality: 'singles', my_person_id: 'p1', rows: [row] }

describe('parseRanking', () => {
  it('acepta la respuesta del servidor', () => {
    expect(parseRanking(payload)).toEqual(payload)
  })
  it('no inventa datos: una respuesta con otra forma se descarta', () => {
    expect(parseRanking(null)).toBeNull()
    expect(parseRanking({ ...payload, modality: 'padel' })).toBeNull()
    expect(parseRanking({ ...payload, rows: [{ ...row, points: '160' }] })).toBeNull()
    expect(parseRanking({ ...payload, rows: 'x' })).toBeNull()
  })
  it('my_person_id es opcional', () => {
    expect(parseRanking({ ...payload, my_person_id: null })?.my_person_id).toBeNull()
  })
})

describe('parseRankingDetail', () => {
  const item = { tournament_id: 't1', tournament_name: 'Apertura', category_id: 'c1', category_name: '3ra', entry_name: 'Ana Gómez', ends_on: '2026-06-15', result: 'champion', points: 100 }
  it('valida cada resultado', () => {
    expect(parseRankingDetail([item])).toEqual([item])
    expect(parseRankingDetail([{ ...item, result: 'ganador' }])).toBeNull()
    expect(parseRankingDetail({})).toBeNull()
  })
})

describe('textos y selector', () => {
  it('incluye la temporada mostrada aunque no tenga datos y ordena de la más reciente', () => {
    expect(seasonOptions({ season: 2027, seasons: [2025, 2026] })).toEqual([2027, 2026, 2025])
    expect(seasonOptions({ season: 2026, seasons: [2026] })).toEqual([2026])
  })
  it('singular y plural', () => {
    expect(tournamentsLabel(1)).toBe('1 torneo')
    expect(tournamentsLabel(3)).toBe('3 torneos')
    expect(titlesLabel(1)).toBe('1 ganado')
    expect(titlesLabel(0)).toBe('0 ganados')
  })
})

describe('consultas', () => {
  it('piden el ranking del club indicado, con temporada y modalidad, y devuelven null ante un error', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: payload, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    const client = { rpc } as unknown as SupabaseClient
    expect(await fetchRanking(client, 'club-a', 2026, 'singles')).toEqual(payload)
    expect(rpc).toHaveBeenCalledWith('club_ranking', { p_club_id: 'club-a', p_season: 2026, p_modality: 'singles' })
    expect(await fetchRanking(client, 'club-a', null, 'doubles')).toBeNull()
  })
  it('el detalle se pide por persona', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(await fetchRankingDetail(client, 'club-a', 2026, 'doubles', 'p1')).toEqual([])
    expect(rpc).toHaveBeenCalledWith('club_ranking_player_detail', { p_club_id: 'club-a', p_season: 2026, p_modality: 'doubles', p_person_id: 'p1' })
  })
})
