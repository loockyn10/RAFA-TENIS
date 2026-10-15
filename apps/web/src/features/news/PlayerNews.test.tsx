import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { ClubPost, PlayerClubAccess } from '../../types/domain'
import { todayInTimezone } from '../reservations/reservationUtils'
import { PlayerNews, type NewsRemote } from './PlayerNews'

const club: PlayerClubAccess = { club_id: 'club-1', club_name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires', person_id: 'p1', full_name: 'Juan Pérez', membership_status: null }
const today = todayInTimezone(club.timezone)
const shift = (days: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }

const post = (id: string, patch: Partial<ClubPost>): ClubPost => ({
  id, kind: 'news', title: `Título ${id}`, body: `Descripción ${id}`, is_featured: false, event_date: null, event_time: null, location: null, image_path: null, tournament_id: null,
  published_at: '2026-10-01T12:00:00Z', ...patch,
})
const client = { storage: { from: () => ({ createSignedUrls: vi.fn().mockResolvedValue({ data: [{ path: 'club-1/img.png', signedUrl: 'https://signed.test/img.png' }], error: null }) }) } } as unknown as SupabaseClient
const ready = (data: ClubPost[]): NewsRemote => ({ status: 'ready', data })
const renderNews = (feed: NewsRemote, extra: { openPostId?: string | null; onOpenHandled?: () => void; onRetry?: () => void } = {}) =>
  render(<PlayerNews client={client} club={club} feed={feed} onRetry={extra.onRetry ?? vi.fn()} openPostId={extra.openPostId} onOpenHandled={extra.onOpenHandled} />)

describe('PlayerNews', () => {
  it('muestra próximos eventos por fecha, novedades con título/fecha/descripción y eventos anteriores plegados', () => {
    renderNews(ready([
      post('lejano', { kind: 'event', event_date: shift(20), event_time: '18:00:00', location: 'Quincho' }),
      post('cercano', { kind: 'event', event_date: shift(2), event_time: '21:00:00', location: 'Cancha 3' }),
      post('pasado', { kind: 'event', event_date: shift(-5), event_time: '10:00:00' }),
      post('aviso', { title: 'Cierre por lluvia', body: 'Hoy no abrimos las canchas.' }),
    ]))
    const upcoming = within(screen.getByRole('region', { name: 'Próximos eventos' }))
    const titles = upcoming.getAllByRole('button').map((button) => button.textContent ?? '')
    expect(titles).toHaveLength(2)
    expect(titles[0]).toContain('Título cercano')
    expect(titles[0]).toContain('21:00 hs')
    expect(titles[0]).toContain('Cancha 3')
    expect(titles[1]).toContain('Título lejano')
    const news = within(screen.getByRole('region', { name: 'Novedades recientes' }))
    expect(news.getByText('Cierre por lluvia')).toBeInTheDocument()
    expect(news.getByText('Hoy no abrimos las canchas.')).toBeInTheDocument()
    expect(screen.queryByText('Título pasado')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ver \(1\)/ }))
    expect(screen.getByText('Título pasado')).toBeInTheDocument()
  })

  it('las publicaciones destacadas van primero y no se repiten', () => {
    renderNews(ready([post('a', { is_featured: true, title: 'Importante' }), post('b', { title: 'Común' })]))
    const featured = within(screen.getByRole('region', { name: 'Destacadas' }))
    expect(featured.getByText('Importante')).toBeInTheDocument()
    expect(screen.getAllByText('Importante')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Novedades recientes' })).getByText('Común')).toBeInTheDocument()
  })

  it('abre el detalle completo de un evento con fecha, horario, lugar y descripción', () => {
    renderNews(ready([post('e', { kind: 'event', title: 'Peña de fin de mes', body: 'Asado para socios.\nTraé a tu familia.', event_date: shift(3), event_time: '21:00:00', location: 'Quincho' })]))
    fireEvent.click(screen.getByRole('button', { name: /Peña de fin de mes/ }))
    const dialog = screen.getByRole('dialog', { name: 'Peña de fin de mes' })
    expect(within(dialog).getByText('21:00 hs')).toBeInTheDocument()
    expect(within(dialog).getByText('Quincho')).toBeInTheDocument()
    expect(within(dialog).getByText(/Asado para socios\./)).toBeInTheDocument()
    expect(within(dialog).getByText('En 3 días')).toBeInTheDocument()
  })

  it('un evento sin hora no inventa un horario', () => {
    renderNews(ready([post('e', { kind: 'event', event_date: shift(1), event_time: null })]))
    expect(screen.getByRole('button', { name: /Título e/ }).textContent).toContain('Horario a confirmar')
  })

  it('el contenido es texto: etiquetas HTML guardadas por error se ven literales y no se ejecutan ni crean elementos', () => {
    const { container } = renderNews(ready([post('x', { title: '<b>negrita</b>', body: '<img src=x onerror=alert(1)> y <script>alert(2)</script>' })]))
    fireEvent.click(screen.getByRole('button', { name: /<b>negrita<\/b>/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('muestra la portada firmada cuando existe y no rompe si falta', async () => {
    renderNews(ready([post('n', { image_path: 'club-1/img.png' }), post('m', {})]))
    await waitFor(() => expect(document.querySelector('img.nv-cover')).toHaveAttribute('src', 'https://signed.test/img.png'))
    expect(document.querySelectorAll('img')).toHaveLength(1)
  })

  it('abre la publicación pedida desde una notificación una sola vez', () => {
    const handled = vi.fn()
    renderNews(ready([post('target', { title: 'Publicación objetivo' })]), { openPostId: 'target', onOpenHandled: handled })
    expect(screen.getByRole('dialog', { name: 'Publicación objetivo' })).toBeInTheDocument()
    expect(handled).toHaveBeenCalled()
  })

  it('estados: cargando, error con reintento y vacío', () => {
    const retry = vi.fn()
    const { rerender } = render(<PlayerNews client={client} club={club} feed={{ status: 'loading', data: [] }} onRetry={retry} />)
    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument()
    rerender(<PlayerNews client={client} club={club} feed={{ status: 'error', data: [] }} onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(retry).toHaveBeenCalled()
    rerender(<PlayerNews client={client} club={club} feed={ready([])} onRetry={retry} />)
    expect(screen.getByText('Todavía no hay novedades')).toBeInTheDocument()
  })
})
