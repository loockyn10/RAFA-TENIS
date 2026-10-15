import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, EmptyState, ErrorState, Field, Icon, Modal, SegmentedTabs, SelectInput, SkeletonCards } from '../../design/ui'
import { dateShort } from '../../design/dates'
import {
  MODALITY_LABEL, POINTS_SCALE, RESULT_LABEL, fetchRanking, fetchRankingDetail, seasonOptions, titlesLabel, tournamentsLabel,
  type RankingData, type RankingDetailItem, type RankingModality, type RankingRow,
} from './rankingUtils'

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: RankingData }
type DetailState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: RankingDetailItem[] }

/**
 * Ranking interno del club (Singles / Dobles, por temporada). Solo lectura: los puntos los calcula PostgreSQL a partir
 * de los torneos finalizados; esta pantalla no envía ni conserva puntaje alguno. Se usa en administración y en el portal.
 */
export function RankingView({ client, clubId }: { client: SupabaseClient; clubId: string }) {
  const [modality, setModality] = useState<RankingModality>('singles')
  const [season, setSeason] = useState<number | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [opened, setOpened] = useState<RankingRow | null>(null)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    setLoad({ status: 'loading' })
    const data = await fetchRanking(client, clubId, season, modality)
    if (request !== requestRef.current) return
    setLoad(data ? { status: 'ready', data } : { status: 'error' })
  }, [client, clubId, season, modality])

  useEffect(() => { void reload() }, [reload])
  // Al cambiar de club se vuelve a la temporada más reciente de ese club.
  useEffect(() => { setSeason(null); setOpened(null) }, [clubId])

  const data = load.status === 'ready' ? load.data : null
  const options = data ? seasonOptions(data) : []
  return (
    <div className="ranking">
      <div className="ranking-controls">
        <SegmentedTabs label="Modalidad del ranking" stretch value={modality} onChange={(next) => { setModality(next); setOpened(null) }} items={[{ id: 'singles', label: MODALITY_LABEL.singles, icon: 'user' }, { id: 'doubles', label: MODALITY_LABEL.doubles, icon: 'users' }]} />
        {data && options.length > 1 && (
          <Field label="Temporada">{(id) => <SelectInput id={id} value={data.season} onChange={(event) => setSeason(Number(event.target.value))}>{options.map((item) => <option key={item} value={item}>{item}</option>)}</SelectInput>}</Field>
        )}
      </div>
      {load.status === 'loading' && <SkeletonCards count={4} height={64} />}
      {load.status === 'error' && <ErrorState title="No pudimos cargar el ranking" body="Revisá la conexión e intentá de nuevo. Confirmá también que la migración del ranking esté aplicada." onRetry={() => void reload()} />}
      {data && data.rows.length === 0 && (
        <div className="card">
          <EmptyState icon="trophy" title={`Todavía no hay ranking de ${MODALITY_LABEL[data.modality]} ${data.season}`} body="El ranking se arma solo cuando finaliza un torneo del club. Los torneos en curso o con inscripción abierta todavía no suman puntos." />
        </div>
      )}
      {data && data.rows.length > 0 && (
        <>
          <p className="ranking-meta"><b>Temporada {data.season}</b> · {MODALITY_LABEL[data.modality]}</p>
          <ol className="ranking-list" aria-label={`Ranking ${MODALITY_LABEL[data.modality]} ${data.season}`}>
            {data.rows.map((row) => <RankingItem key={row.person_id} row={row} mine={row.person_id === data.my_person_id} onOpen={() => setOpened(row)} />)}
          </ol>
        </>
      )}
      {data && (
        <p className="detail-footnote ranking-scale"><Icon name="info" size={16} />
          <span>Cada torneo suma una sola vez, por la mejor instancia alcanzada: {POINTS_SCALE.map((item) => `${RESULT_LABEL[item.result]} ${item.points}`).join(' · ')}. Los pases libres y los W.O. no suman puntos por sí mismos. En dobles, cada integrante suma los puntos de la pareja.</span>
        </p>
      )}
      {opened && data && <RankingDetail client={client} clubId={clubId} season={data.season} modality={data.modality} row={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}

function RankingItem({ row, mine, onOpen }: { row: RankingRow; mine: boolean; onOpen: () => void }) {
  const podium = row.position <= 3
  return (
    <li className={`ranking-item ${podium ? `is-top is-top-${row.position}` : ''} ${mine ? 'is-mine' : ''}`}>
      <button type="button" onClick={onOpen} aria-label={`${row.name}, puesto ${row.position}, ${row.points} puntos. Ver detalle`}>
        <span className="ranking-pos display num" aria-hidden="true">{podium ? <Icon name="medal" size={18} /> : null}{row.position}</span>
        <span className="ranking-main">
          <strong>{row.name}{mine && <Badge tone="clay">Vos</Badge>}</strong>
          <span>{tournamentsLabel(row.tournaments)} · {titlesLabel(row.titles)}</span>
        </span>
        <span className="ranking-points"><b className="display num">{row.points}</b><small>pts</small></span>
        <Icon name="chevronRight" size={18} />
      </button>
    </li>
  )
}

function RankingDetail({ client, clubId, season, modality, row, onClose }: { client: SupabaseClient; clubId: string; season: number; modality: RankingModality; row: RankingRow; onClose: () => void }) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const load = useCallback(async () => {
    setState({ status: 'loading' })
    const items = await fetchRankingDetail(client, clubId, season, modality, row.person_id)
    setState(items ? { status: 'ready', items } : { status: 'error' })
  }, [client, clubId, season, modality, row.person_id])
  useEffect(() => { void load() }, [load])

  return (
    <Modal open onClose={onClose} size="md" title={row.name} footer={<div className="form-actions"><Button variant="secondary" onClick={onClose}>Cerrar</Button></div>}>
      <p className="ranking-meta"><b>{row.points} pts</b> · puesto {row.position} · {MODALITY_LABEL[modality]} {season}</p>
      {state.status === 'loading' && <SkeletonCards count={2} height={56} />}
      {state.status === 'error' && <ErrorState title="No pudimos cargar el detalle" onRetry={() => void load()} />}
      {state.status === 'ready' && (state.items.length === 0 ? <p className="muted">No hay torneos con puntos en esta temporada.</p> : (
        <ul className="ranking-detail">
          {state.items.map((item) => (
            <li key={item.category_id}>
              <span className="ranking-detail-main">
                <strong>{item.tournament_name}</strong>
                <span>{item.category_name}{modality === 'doubles' ? ` · ${item.entry_name}` : ''} · {dateShort(item.ends_on)}</span>
              </span>
              <span className="ranking-detail-result"><Badge tone={item.result === 'champion' ? 'accent' : item.result === 'finalist' ? 'success' : 'neutral'}>{RESULT_LABEL[item.result]}</Badge><b className="num">+{item.points}</b></span>
            </li>
          ))}
        </ul>
      ))}
    </Modal>
  )
}
