import { Badge, Button, Icon, Modal } from '../../design/ui'
import type { ClubPost } from '../../types/domain'
import { eventDateLabel, eventDateParts, eventTimeLabel, excerpt, publishedLabel, relativeEventLabel } from './newsUtils'

/*
 * Tarjetas de Novedades compartidas por el portal del jugador y la vista de solo lectura del personal.
 * Todo el contenido se renderiza como TEXTO de React (nunca como HTML) y respeta los saltos de línea con CSS (white-space: pre-line).
 */

export function DateBlock({ date, muted = false }: { date: string; muted?: boolean }) {
  const parts = eventDateParts(date)
  return (
    <span className={`nv-date ${muted ? 'is-muted' : ''}`} aria-hidden="true">
      <small>{parts.weekday}</small>
      <b className="display num">{parts.day}</b>
      <small>{parts.month}</small>
    </span>
  )
}

type CardProps = { post: ClubPost; imageUrl?: string; today: string; timezone: string; onOpen: (post: ClubPost) => void }

export function EventCard({ post, imageUrl, today, onOpen }: CardProps) {
  const date = post.event_date ?? today
  const past = date < today
  return (
    <button type="button" className={`card nv-card nv-event ${past ? 'is-past' : ''} ${post.is_featured ? 'is-featured' : ''}`} onClick={() => onOpen(post)}>
      <DateBlock date={date} muted={past} />
      <span className="nv-main">
        <span className="badge-row">
          <Badge tone={past ? 'neutral' : 'clay'} icon="calendar">Evento</Badge>
          {!past && <Badge tone={date === today ? 'accent' : 'info'}>{relativeEventLabel(date, today)}</Badge>}
          {post.is_featured && !past && <Badge tone="accent" icon="star">Destacado</Badge>}
        </span>
        <strong className="nv-title">{post.title}</strong>
        <span className="nv-meta">
          <span><Icon name="clock" size={15} />{eventTimeLabel(post.event_time)}</span>
          {post.location && <span><Icon name="mapPin" size={15} />{post.location}</span>}
        </span>
      </span>
      {imageUrl && <img className="nv-thumb" src={imageUrl} alt="" loading="lazy" />}
      <Icon name="chevronRight" size={18} className="row-chevron" />
    </button>
  )
}

export function NewsCard({ post, imageUrl, timezone, onOpen }: CardProps) {
  return (
    <button type="button" className={`card nv-card nv-news ${post.is_featured ? 'is-featured' : ''} ${imageUrl ? 'has-image' : ''}`} onClick={() => onOpen(post)}>
      {imageUrl && <img className="nv-cover" src={imageUrl} alt="" loading="lazy" />}
      <span className="nv-main">
        <span className="badge-row">
          <Badge tone="success" icon="news">Novedad</Badge>
          {post.is_featured && <Badge tone="accent" icon="star">Destacada</Badge>}
        </span>
        <strong className="nv-title">{post.title}</strong>
        <span className="nv-excerpt">{excerpt(post.body, 150)}</span>
        <span className="nv-date-line">{publishedLabel(post.published_at, timezone)}</span>
      </span>
    </button>
  )
}

/** Detalle completo de una publicación. El texto conserva los saltos de línea; no se interpreta como HTML. */
export function PostDetailModal({ post, imageUrl, timezone, today, onClose }: { post: ClubPost | null; imageUrl?: string; timezone: string; today: string; onClose: () => void }) {
  return (
    <Modal open={post !== null} onClose={onClose} title={post?.title ?? ''} eyebrow={post ? (post.kind === 'event' ? 'Evento del club' : 'Novedad del club') : undefined} footer={<div className="form-actions"><Button variant="secondary" onClick={onClose}>Cerrar</Button></div>}>
      {post && (
        <article className="nv-detail">
          {imageUrl && <img className="nv-detail-image" src={imageUrl} alt="" />}
          <div className="badge-row">
            <Badge tone={post.kind === 'event' ? 'clay' : 'success'} icon={post.kind === 'event' ? 'calendar' : 'news'}>{post.kind === 'event' ? 'Evento' : 'Novedad'}</Badge>
            {post.is_featured && <Badge tone="accent" icon="star">Destacada</Badge>}
            {post.kind === 'event' && post.event_date && <Badge tone={post.event_date < today ? 'neutral' : 'info'}>{relativeEventLabel(post.event_date, today)}</Badge>}
          </div>
          {post.kind === 'event' && post.event_date && (
            <dl className="nv-facts">
              <div><dt><Icon name="calendar" size={16} />Fecha</dt><dd>{eventDateLabel(post.event_date)}</dd></div>
              <div><dt><Icon name="clock" size={16} />Horario</dt><dd>{eventTimeLabel(post.event_time)}</dd></div>
              {post.location && <div><dt><Icon name="mapPin" size={16} />Lugar</dt><dd>{post.location}</dd></div>}
            </dl>
          )}
          <p className="nv-body">{post.body}</p>
          {post.published_at && <p className="nv-date-line">Publicado el {publishedLabel(post.published_at, timezone)}</p>}
        </article>
      )}
    </Modal>
  )
}
