import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { RankingView } from './RankingView'

type Handler = (args: Record<string, unknown>) => unknown
const row = (position: number, name: string, points: number, patch: Record<string, unknown> = {}) => ({ position, person_id: `p-${name}`, name, points, tournaments: 2, titles: 1, runner_ups: 0, ...patch })
const ranking = (patch: Record<string, unknown> = {}) => ({ season: 2026, seasons: [2026, 2025], modality: 'singles', my_person_id: null, rows: [], ...patch })

function makeClient(handlers: { club_ranking?: Handler; club_ranking_player_detail?: Handler }) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    const handler = handlers[name as keyof typeof handlers]
    return Promise.resolve(handler ? handler(args) : { data: null, error: { message: 'sin handler' } })
  })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('RankingView', () => {
  it('muestra el estado vacío cuando no hay torneos finalizados, sin datos ficticios', async () => {
    const { client } = makeClient({ club_ranking: () => ({ data: ranking({ season: 2026, seasons: [] }), error: null }) })
    render(<RankingView client={client} clubId="club-a" />)
    expect(await screen.findByText('Todavía no hay ranking de Singles 2026')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /Ranking/ })).not.toBeInTheDocument()
  })

  it('lista posición, nombre, puntos, torneos y ganados; destaca el top 3 y a la persona autenticada', async () => {
    const { client } = makeClient({
      club_ranking: () => ({ data: ranking({ my_person_id: 'p-Cora', rows: [row(1, 'Ana', 190, { tournaments: 3, titles: 2 }), row(2, 'Beto', 100), row(3, 'Cora', 60, { tournaments: 1, titles: 0 }), row(4, 'Dante', 35)] }), error: null }),
    })
    render(<RankingView client={client} clubId="club-a" />)
    const list = await screen.findByRole('list', { name: 'Ranking Singles 2026' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveClass('is-top-1')
    expect(items[2]).toHaveClass('is-top-3')
    expect(items[3]).not.toHaveClass('is-top')
    expect(within(items[0]).getByText('3 torneos · 2 ganados')).toBeInTheDocument()
    expect(within(items[0]).getByText('190')).toBeInTheDocument()
    expect(within(items[2]).getByText('1 torneo · 0 ganados')).toBeInTheDocument()
    // Solo la fila de la persona autenticada se marca como propia.
    expect(items.filter((item) => item.classList.contains('is-mine'))).toHaveLength(1)
    expect(items[2]).toHaveClass('is-mine')
    expect(within(items[2]).getByText('Vos')).toBeInTheDocument()
  })

  it('alterna Singles/Dobles y cambia de temporada consultando al servidor', async () => {
    const { client, rpc } = makeClient({
      club_ranking: (args) => ({ data: ranking({ modality: args.p_modality, season: (args.p_season as number | null) ?? 2026, rows: [row(1, args.p_modality === 'doubles' ? 'Pareja' : 'Solo', 100)] }), error: null }),
    })
    render(<RankingView client={client} clubId="club-a" />)
    await screen.findByText('Solo')
    expect(rpc).toHaveBeenCalledWith('club_ranking', { p_club_id: 'club-a', p_season: null, p_modality: 'singles' })
    fireEvent.click(screen.getByRole('tab', { name: 'Dobles' }))
    expect(await screen.findByText('Pareja')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('club_ranking', { p_club_id: 'club-a', p_season: null, p_modality: 'doubles' })
    fireEvent.change(screen.getByLabelText('Temporada'), { target: { value: '2025' } })
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('club_ranking', { p_club_id: 'club-a', p_season: 2025, p_modality: 'doubles' }))
  })

  it('abre el detalle con los torneos que aportaron puntos', async () => {
    const { client, rpc } = makeClient({
      club_ranking: () => ({ data: ranking({ rows: [row(1, 'Ana', 160)] }), error: null }),
      club_ranking_player_detail: () => ({ data: [
        { tournament_id: 't1', tournament_name: 'Apertura', category_id: 'c1', category_name: '3ra', entry_name: 'Ana', ends_on: '2026-06-15', result: 'champion', points: 100 },
        { tournament_id: 't2', tournament_name: 'Clausura', category_id: 'c2', category_name: '3ra', entry_name: 'Ana', ends_on: '2026-09-20', result: 'finalist', points: 60 },
      ], error: null }),
    })
    render(<RankingView client={client} clubId="club-a" />)
    fireEvent.click(await screen.findByRole('button', { name: /Ana, puesto 1, 160 puntos/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Ana' })
    expect(await within(dialog).findByText('Apertura')).toBeInTheDocument()
    expect(within(dialog).getByText('Campeón')).toBeInTheDocument()
    expect(within(dialog).getByText('+60')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('club_ranking_player_detail', { p_club_id: 'club-a', p_season: 2026, p_modality: 'singles', p_person_id: 'p-Ana' })
  })

  it('ofrece reintentar si falla la carga', async () => {
    let calls = 0
    const { client } = makeClient({ club_ranking: () => (++calls === 1 ? { data: null, error: { message: 'boom' } } : { data: ranking({ rows: [row(1, 'Ana', 100)] }), error: null }) })
    render(<RankingView client={client} clubId="club-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Ana')).toBeInTheDocument()
  })
})
