import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, EmptyState, ErrorState, SectionHeader, SkeletonCards } from '../../design/ui'
import { todayInTimezone } from '../reservations/reservationUtils'
import type { ClubPost, PlayerClubAccess } from '../../types/domain'
import { EventCard, NewsCard, PostDetailModal } from './PostCards'
import { splitFeed } from './newsUtils'
import { useSignedImages } from './useSignedImages'

export type NewsRemote = { status: 'loading' | 'ready' | 'error'; data: ClubPost[] }

type Props = {
  client: SupabaseClient
  club: PlayerClubAccess
  feed: NewsRemote
  onRetry: () => void
  /** Publicación a abrir al llegar desde una notificación. Se consume una sola vez. */
  openPostId?: string | null
  onOpenHandled?: () => void
}

/** Sección «Novedades» del portal: destacadas, próximos eventos (por fecha), comunicados recientes y eventos anteriores. */
export function PlayerNews({ client, club, feed, onRetry, openPostId, onOpenHandled }: Props) {
  const today = todayInTimezone(club.timezone)
  const groups = useMemo(() => splitFeed(feed.data, today), [feed.data, today])
  const images = useSignedImages(client, feed.data.map((post) => post.image_path))
  const [selected, setSelected] = useState<ClubPost | null>(null)
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    if (!openPostId || feed.status === 'loading') return
    const target = feed.data.find((post) => post.id === openPostId)
    if (target) setSelected(target)
    onOpenHandled?.()
  }, [openPostId, feed.status, feed.data, onOpenHandled])

  const card = (post: ClubPost) => {
    const shared = { post, today, timezone: club.timezone, imageUrl: post.image_path ? images[post.image_path] : undefined, onOpen: setSelected }
    return post.kind === 'event' ? <EventCard key={post.id} {...shared} /> : <NewsCard key={post.id} {...shared} />
  }
  const empty = feed.status === 'ready' && feed.data.length === 0

  return (
    <div className="nv-page">
      <header className="p-page-head">
        <p className="kicker">{club.club_name}</p>
        <h1 className="display">Novedades</h1>
      </header>

      {feed.status === 'loading' && <SkeletonCards count={3} height={110} />}
      {feed.status === 'error' && <ErrorState title="No pudimos cargar las novedades" onRetry={onRetry} />}
      {empty && <div className="card"><EmptyState icon="news" title="Todavía no hay novedades" body="Cuando el club publique noticias o eventos, los vas a ver acá." /></div>}

      {feed.status === 'ready' && !empty && (
        <>
          {groups.featured.length > 0 && (
            <section aria-labelledby="nv-featured"><SectionHeader id="nv-featured" title="Destacadas" /><div className="nv-list">{groups.featured.map(card)}</div></section>
          )}
          {groups.upcoming.length > 0 && (
            <section aria-labelledby="nv-upcoming"><SectionHeader id="nv-upcoming" eyebrow="Agenda del club" title="Próximos eventos" /><div className="nv-list">{groups.upcoming.map(card)}</div></section>
          )}
          {groups.featured.length === 0 && groups.upcoming.length === 0 && groups.news.length === 0 && groups.past.length > 0 && (
            <div className="card"><EmptyState icon="calendar" title="No hay eventos próximos" body="Cuando se anuncie una nueva actividad la vas a ver acá." /></div>
          )}
          {groups.news.length > 0 && (
            <section aria-labelledby="nv-news"><SectionHeader id="nv-news" title="Novedades recientes" /><div className="nv-list nv-grid">{groups.news.map(card)}</div></section>
          )}
          {groups.past.length > 0 && (
            <section aria-labelledby="nv-past">
              <SectionHeader id="nv-past" title="Eventos anteriores" action={<Button variant="ghost" size="sm" iconRight={showPast ? 'chevronUp' : 'chevronDown'} aria-expanded={showPast} onClick={() => setShowPast((value) => !value)}>{showPast ? 'Ocultar' : `Ver (${groups.past.length})`}</Button>} />
              {showPast && <div className="nv-list">{groups.past.map(card)}</div>}
            </section>
          )}
        </>
      )}

      <PostDetailModal post={selected} imageUrl={selected?.image_path ? images[selected.image_path] : undefined} timezone={club.timezone} today={today} onClose={() => setSelected(null)} />
    </div>
  )
}
