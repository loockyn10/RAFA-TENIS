import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Icon, PageHead, SegmentedTabs, SkeletonCards, Switch } from '../../design/ui'
import { useAsyncAction } from '../../design/useAsyncAction'
import { plural } from '../../design/format'
import { todayInTimezone } from '../reservations/reservationUtils'
import type { AdminClubPost, Club, ClubPost, PostStatus } from '../../types/domain'
import { triggerPushDispatch } from '../notifications/pushClient'
import { archivePost, fetchAdminPosts, fetchFeed, fetchTournamentOptions, publishPost, type TournamentOption } from './newsApi'
import { PostFormModal, type FormResult } from './PostFormModal'
import { EventCard, NewsCard, PostDetailModal } from './PostCards'
import { canNotifyPost, eventDateLabel, eventTimeLabel, excerpt, notifyByDefault, publishedLabel } from './newsUtils'
import { useSignedImages } from './useSignedImages'

type Tab = PostStatus
type FormState = { post: AdminClubPost | null; id: number } | null

const STATUS_BADGE: Record<PostStatus, { tone: 'neutral' | 'success' | 'warning'; label: string }> = {
  draft: { tone: 'warning', label: 'Borrador' },
  published: { tone: 'success', label: 'Publicada' },
  archived: { tone: 'neutral', label: 'Archivada' },
}
const EMPTY_TEXT: Record<Tab, { title: string; body: string }> = {
  published: { title: 'No hay publicaciones visibles', body: 'Creá una noticia o un evento y publicalo para que los jugadores lo vean en su portal.' },
  draft: { title: 'No hay borradores', body: 'Los borradores solo los ves vos: nadie más puede leerlos ni recibe avisos.' },
  archived: { title: 'No hay publicaciones archivadas', body: 'Lo que archives sale del portal pero queda acá para consultarlo.' },
}

/**
 * Novedades del club. Owner/admin crean, editan, publican y archivan; el personal operativo solo consulta lo publicado.
 * Los permisos reales (RLS y RPC) viven en PostgreSQL: ocultar botones acá es solo claridad para quien usa la pantalla.
 */
export function NewsAdminPanel({ client, club, canManage }: { client: SupabaseClient; club: Club; canManage: boolean }) {
  const today = todayInTimezone(club.timezone)
  const [posts, setPosts] = useState<AdminClubPost[]>([])
  const [feed, setFeed] = useState<ClubPost[]>([])
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tab, setTab] = useState<Tab>('published')
  const [form, setForm] = useState<FormState>(null)
  const [publishing, setPublishing] = useState<AdminClubPost | null>(null)
  const [notify, setNotify] = useState(false)
  const [archiving, setArchiving] = useState<AdminClubPost | null>(null)
  const [viewing, setViewing] = useState<ClubPost | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const publishAction = useAsyncAction()
  const archiveAction = useAsyncAction()

  const load = useCallback(async () => {
    const result = canManage ? await fetchAdminPosts(client, club.id) : await fetchFeed(client, club.id)
    if (!result.ok) { setStatus('error'); return }
    if (canManage) setPosts(result.data as AdminClubPost[]); else setFeed(result.data as ClubPost[])
    setStatus('ready')
  }, [client, club.id, canManage])

  useEffect(() => {
    setStatus('loading'); setNotice(null)
    void load()
    if (canManage) void fetchTournamentOptions(client, club.id).then(setTournaments)
  }, [load, canManage, client, club.id])

  const visible = useMemo(() => {
    const filtered = posts.filter((post) => post.status === tab)
    // Publicadas: lo más próximo/reciente primero; borradores y archivadas: lo último que se tocó.
    return filtered.sort((a, b) => tab === 'published' ? (b.published_at ?? '').localeCompare(a.published_at ?? '') : b.updated_at.localeCompare(a.updated_at))
  }, [posts, tab])
  const counts = useMemo(() => ({ published: posts.filter((post) => post.status === 'published').length, draft: posts.filter((post) => post.status === 'draft').length, archived: posts.filter((post) => post.status === 'archived').length }), [posts])
  const images = useSignedImages(client, canManage ? posts.map((post) => post.image_path) : feed.map((post) => post.image_path))

  const finishedForm = ({ post, published }: FormResult) => {
    setForm(null)
    if (published) {
      setNotice(published.notified ? `Publicada. Avisamos a ${plural(published.recipients, 'jugador', 'jugadores')}.` : published.already_notified ? 'Publicada. El aviso ya se había enviado antes.' : 'Publicada.')
      if (published.notified) void triggerPushDispatch(client)
      setTab('published')
    } else {
      setNotice(post.status === 'draft' ? 'Borrador guardado. Nadie más lo ve ni recibe avisos.' : 'Cambios guardados.')
      setTab(post.status)
    }
    void load()
  }

  const openPublish = (post: AdminClubPost) => { publishAction.reset(); setNotify(post.status === 'published' || notifyByDefault(post)); setPublishing(post) }
  const confirmPublish = () => {
    if (!publishing) return
    void publishAction.run(async () => {
      const result = await publishPost(client, publishing.id, (notify || publishing.status === 'published') && canNotifyPost(publishing))
      if (!result.ok) return result.message
      const outcome = result.data
      setNotice(outcome.notified ? `Publicada. Avisamos a ${plural(outcome.recipients, 'jugador', 'jugadores')}.` : outcome.already_notified ? 'El aviso ya se había enviado antes: no se repite.' : 'Publicada.')
      if (outcome.notified) void triggerPushDispatch(client)
      setPublishing(null); setTab('published'); void load()
      return null
    })
  }
  const confirmArchive = () => {
    if (!archiving) return
    void archiveAction.run(async () => {
      const result = await archivePost(client, archiving.id)
      if (!result.ok) return result.message
      setNotice('Archivada. Ya no se ve en el portal.'); setArchiving(null); void load()
      return null
    })
  }

  const newForm = () => setForm({ post: null, id: Date.now() })

  return (
    <div className="module nv-admin">
      <PageHead eyebrow="Club" title="Novedades" meta={canManage ? 'Noticias y eventos que ven los jugadores en su portal' : 'Lo que el club publicó para los jugadores'}
        actions={canManage ? <Button variant="accent" icon="plus" onClick={newForm}>Nueva publicación</Button> : undefined} />
      {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}

      {canManage && (
        <div className="module-tabs">
          <SegmentedTabs<Tab> label="Estado de las publicaciones" value={tab} onChange={setTab}
            items={[{ id: 'published', label: 'Publicadas', count: counts.published }, { id: 'draft', label: 'Borradores', count: counts.draft }, { id: 'archived', label: 'Archivadas', count: counts.archived }]} />
        </div>
      )}

      {status === 'loading' && <SkeletonCards count={3} height={110} />}
      {status === 'error' && <ErrorState title="No pudimos cargar las novedades" onRetry={() => { setStatus('loading'); void load() }} />}

      {status === 'ready' && canManage && (visible.length === 0
        ? <div className="card"><EmptyState icon="news" title={EMPTY_TEXT[tab].title} body={EMPTY_TEXT[tab].body} action={tab !== 'archived' ? <Button variant="accent" icon="plus" onClick={newForm}>Nueva publicación</Button> : undefined} /></div>
        : (
          <ul className="nv-admin-list" aria-label="Publicaciones">
            {visible.map((post) => (
              <li key={post.id} className="card nv-admin-row">
                <div className="nv-admin-main">
                  <div className="badge-row">
                    <Badge tone={post.kind === 'event' ? 'clay' : 'success'} icon={post.kind === 'event' ? 'calendar' : 'news'}>{post.kind === 'event' ? 'Evento' : 'Noticia'}</Badge>
                    <Badge tone={STATUS_BADGE[post.status].tone}>{STATUS_BADGE[post.status].label}</Badge>
                    {post.is_featured && <Badge tone="accent" icon="star">Destacada</Badge>}
                    {post.notified_at && <Badge tone="info" icon="bell">Aviso enviado</Badge>}
                  </div>
                  <strong className="nv-title">{post.title}</strong>
                  {post.kind === 'event' && post.event_date && <span className="nv-meta"><span><Icon name="calendar" size={15} />{eventDateLabel(post.event_date)} · {eventTimeLabel(post.event_time)}</span>{post.location && <span><Icon name="mapPin" size={15} />{post.location}</span>}</span>}
                  <span className="nv-excerpt">{excerpt(post.body, 160)}</span>
                  <span className="nv-date-line">{post.status === 'published' && post.published_at ? `Publicada el ${publishedLabel(post.published_at, club.timezone)}` : `Editada el ${publishedLabel(post.updated_at, club.timezone)}`}</span>
                </div>
                {post.image_path && images[post.image_path] && <img className="nv-thumb" src={images[post.image_path]} alt="" loading="lazy" />}
                <div className="nv-admin-actions">
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setForm({ post, id: Date.now() })}>Editar</Button>
                  {post.status !== 'published' && <Button variant="primary" size="sm" icon="send" onClick={() => openPublish(post)}>Publicar</Button>}
                  {post.status === 'published' && !post.notified_at && canNotifyPost(post) && <Button variant="secondary" size="sm" icon="bell" onClick={() => openPublish(post)}>Enviar aviso</Button>}
                  {post.status !== 'archived' && <Button variant="ghost" size="sm" icon="archive" onClick={() => { archiveAction.reset(); setArchiving(post) }}>Archivar</Button>}
                </div>
              </li>
            ))}
          </ul>
        ))}

      {status === 'ready' && !canManage && (feed.length === 0
        ? <div className="card"><EmptyState icon="news" title="Todavía no hay publicaciones" body="Cuando el club publique novedades las vas a ver acá." /></div>
        : <div className="nv-list">{feed.map((post) => post.kind === 'event'
          ? <EventCard key={post.id} post={post} today={today} timezone={club.timezone} imageUrl={post.image_path ? images[post.image_path] : undefined} onOpen={setViewing} />
          : <NewsCard key={post.id} post={post} today={today} timezone={club.timezone} imageUrl={post.image_path ? images[post.image_path] : undefined} onOpen={setViewing} />)}</div>)}

      {form && <PostFormModal key={form.id} open client={client} club={club} post={form.post} tournaments={tournaments} imageUrl={form.post?.image_path ? images[form.post.image_path] : undefined} onClose={() => setForm(null)} onDone={finishedForm} />}

      <ConfirmDialog open={publishing !== null} title={publishing?.status === 'published' ? 'Enviar aviso' : 'Publicar'} tone="primary" icon="send" confirmLabel={publishing?.status === 'published' ? 'Enviar aviso' : notify && publishing && canNotifyPost(publishing) ? 'Publicar y avisar' : 'Publicar'}
        status={publishAction.status} errorBody={publishAction.message ?? undefined} onConfirm={confirmPublish} onClose={() => setPublishing(null)}>
        <div className="nv-publish">
          <p><strong>{publishing?.title}</strong>{publishing?.status === 'published' ? ' ya está publicada.' : ' quedará visible para los jugadores del club.'}</p>
          {publishing?.status === 'published'
            ? <p>Les llega una notificación en la app (y en el celular si activaron los avisos). Se envía una sola vez.</p>
            : publishing && canNotifyPost(publishing)
            ? <Switch checked={notify} onChange={setNotify} label="Avisar a los jugadores" description="Les llega una notificación en la app (y en el celular si activaron los avisos). Se envía una sola vez." />
            : <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Los comunicados solo envían aviso si están destacados.</span></p>}
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={archiving !== null} title="Archivar publicación" confirmLabel="Archivar" tone="danger" icon="archive" status={archiveAction.status} errorBody={archiveAction.message ?? undefined} onConfirm={confirmArchive} onClose={() => setArchiving(null)}>
        <p><strong>{archiving?.title}</strong> dejará de verse en el portal. Podés consultarla en «Archivadas» y volver a publicarla (sin repetir el aviso).</p>
      </ConfirmDialog>

      <PostDetailModal post={viewing} imageUrl={viewing?.image_path ? images[viewing.image_path] : undefined} timezone={club.timezone} today={today} onClose={() => setViewing(null)} />
    </div>
  )
}
