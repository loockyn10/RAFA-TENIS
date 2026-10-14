import { useState } from 'react'
import type { RoutePath } from '../lib/router'
import { useProto } from '../lib/proto'
import { Avatar, Badge, Button, Chip, CourtMark, Crest, EmptyState, ErrorState, Field, Icon, ICON_NAMES, IconButton, Modal, SegmentedTabs, SelectInput, Skeleton, Stepper, Switch, TextInput } from '../components/ui'

const SWATCHES: { group: string; items: { name: string; token: string; dark?: boolean }[] }[] = [
  { group: 'Verde club', items: [
    { name: 'green-950', token: '--green-950', dark: true }, { name: 'green-900', token: '--green-900', dark: true }, { name: 'green-800', token: '--green-800', dark: true },
    { name: 'green-700', token: '--green-700', dark: true }, { name: 'green-500', token: '--green-500', dark: true }, { name: 'green-100', token: '--green-100' },
  ] },
  { group: 'Amarillo pelota', items: [{ name: 'ball-500', token: '--ball-500' }, { name: 'ball-300', token: '--ball-300' }, { name: 'ball-100', token: '--ball-100' }] },
  { group: 'Polvo de ladrillo', items: [{ name: 'clay-700', token: '--clay-700', dark: true }, { name: 'clay-500', token: '--clay-500', dark: true }, { name: 'clay-100', token: '--clay-100' }] },
  { group: 'Cal y tinta', items: [{ name: 'chalk-0', token: '--chalk-0' }, { name: 'chalk-100', token: '--chalk-100' }, { name: 'chalk-200', token: '--chalk-200' }, { name: 'ink-600', token: '--ink-600', dark: true }, { name: 'ink-900', token: '--ink-900', dark: true }] },
]

export function SystemScreen({ go }: { go: (path: RoutePath) => void }) {
  const { notify } = useProto()
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const [chip, setChip] = useState('1 h')
  const [on, setOn] = useState(true)
  const [qty, setQty] = useState(2)
  const [modal, setModal] = useState(false)

  return (
    <div className="system">
      <header className="system-hero texture-court">
        <Crest size={64} />
        <div>
          <p className="eyebrow eyebrow-on-dark">DESIGN-02 · Prototipo</p>
          <h1 className="display">Sistema visual Rafa Tenis</h1>
          <p>Verde club, amarillo pelota, polvo de ladrillo y cal de línea.</p>
        </div>
        <div className="system-hero-actions">
          <Button variant="accent" icon="home" onClick={() => go('/admin/inicio')}>Administración</Button>
          <Button variant="on-dark" icon="portal" onClick={() => go('/jugador/inicio')}>Portal jugador</Button>
        </div>
      </header>

      <section className="system-section" aria-labelledby="ds-color">
        <h2 id="ds-color" className="section-title">Color</h2>
        <div className="swatch-groups">
          {SWATCHES.map((group) => (
            <div key={group.group}>
              <p className="eyebrow">{group.group}</p>
              <ul className="swatches">
                {group.items.map((item) => (
                  <li key={item.name} className={`swatch ${item.dark ? 'is-dark' : ''}`} style={{ background: `var(${item.token})` }}>
                    <span>{item.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-type">
        <h2 id="ds-type" className="section-title">Tipografía</h2>
        <div className="type-scale">
          <p className="display" style={{ fontSize: 'var(--fs-4xl)' }}>Barlow Condensed 48 · Display</p>
          <p className="display" style={{ fontSize: 'var(--fs-3xl)' }}>4 de 6 canchas en juego</p>
          <p className="display" style={{ fontSize: 'var(--fs-2xl)' }}>Títulos de pantalla 28</p>
          <p style={{ fontSize: 'var(--fs-xl)', fontWeight: 600 }}>Barlow 22 · Subtítulos</p>
          <p style={{ fontSize: 'var(--fs-lg)' }}>Barlow 18 · Texto destacado</p>
          <p>Barlow 16 · Texto base. Las horas usan cifras tabulares: <span className="num">19:00–20:30</span></p>
          <p className="eyebrow">Eyebrow · etiqueta de sección</p>
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-buttons">
        <h2 id="ds-buttons" className="section-title">Botones</h2>
        <div className="system-row">
          <Button variant="accent" icon="plus">Acción principal</Button>
          <Button variant="primary" icon="check">Confirmar</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon="x">Cancelar reserva</Button>
          <Button variant="accent" loading>Guardando…</Button>
          <Button variant="secondary" disabled>Deshabilitado</Button>
          <IconButton icon="edit" label="Editar" variant="secondary" />
        </div>
        <div className="system-row system-dark texture-court">
          <Button variant="accent" size="lg" icon="plus">Nueva reserva</Button>
          <Button variant="on-dark" icon="cart">Sobre verde</Button>
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-badges">
        <h2 id="ds-badges" className="section-title">Badges, chips y pestañas</h2>
        <div className="system-row">
          <Badge tone="success" dot>Libre</Badge>
          <Badge tone="accent" dot>Clase</Badge>
          <Badge tone="clay" dot>Torneo</Badge>
          <Badge tone="neutral" dot>Bloqueo</Badge>
          <Badge tone="warning">Pendiente</Badge>
          <Badge tone="danger" icon="alert">Conflicto</Badge>
          <Badge tone="info" icon="repeat">Turno fijo</Badge>
        </div>
        <div className="system-row">
          {['1 h', '1 h 30', '2 h', 'Otra'].map((item) => <Chip key={item} selected={chip === item} onClick={() => setChip(item)}>{item}</Chip>)}
        </div>
        <div className="system-row">
          <SegmentedTabs label="Ejemplo" value={tab} onChange={setTab} items={[{ id: 'a', label: 'Vender', icon: 'bolt' }, { id: 'b', label: 'A cuenta', count: 4 }, { id: 'c', label: 'Hoy' }]} />
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-forms">
        <h2 id="ds-forms" className="section-title">Formularios</h2>
        <div className="system-grid">
          <Field label="¿Quién juega?" hint="Nombre libre o ficha existente.">{(id, describedBy) => <TextInput id={id} icon="search" placeholder="Ej.: Lucas Benítez" aria-describedby={describedBy} />}</Field>
          <Field label="Desde">{(id) => <SelectInput id={id} defaultValue="19:00"><option>18:30</option><option>19:00</option><option>19:30</option></SelectInput>}</Field>
          <Field label="Nombre" error="Indicá quién juega.">{(id, describedBy) => <TextInput id={id} aria-invalid aria-describedby={describedBy} />}</Field>
          <div className="stack">
            <Switch checked={on} onChange={setOn} label="Repetir cada semana" description="Máximo 12 ocurrencias." />
            <Stepper value={qty} onChange={(value) => setQty(Math.max(0, value))} label="Agua mineral" />
          </div>
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-agenda">
        <h2 id="ds-agenda" className="section-title">Agenda y canchas</h2>
        <div className="system-row">
          <CourtMark label="1" size="lg" />
          <CourtMark label="2" size="md" />
          <CourtMark label="3" size="sm" tone="muted" />
          <CourtMark label="4" size="sm" tone="green" />
          <Avatar name="Martina Gómez" />
          <Avatar name="Lucas Benítez" />
          <Avatar name="Sofía Ramírez" />
        </div>
        <div className="occ-samples">
          {(['reservation', 'lesson', 'match', 'block'] as const).map((kind) => (
            <div key={kind} className={`occ occ-${kind} occ-static`}>
              <span className="occ-title">{kind === 'reservation' ? 'Lucas Benítez' : kind === 'lesson' ? 'Escuela · Adultos' : kind === 'match' ? 'Peralta vs. Romero' : 'Mantenimiento'}</span>
              <span className="occ-meta num">19:00–20:00</span>
            </div>
          ))}
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-states">
        <h2 id="ds-states" className="section-title">Estados y feedback</h2>
        <div className="system-grid">
          <div className="card"><EmptyState icon="calendar" title="Sin turnos por delante" body="La agenda está libre." action={<Button variant="accent" icon="plus">Cargar reserva</Button>} /></div>
          <div className="card"><ErrorState onRetry={() => notify({ tone: 'info', title: 'Reintento simulado' })} /></div>
          <div className="card stack"><Skeleton height={20} width="60%" /><Skeleton height={64} /><Skeleton height={64} /></div>
          <div className="card stack">
            <p className="inline-alert inline-alert-danger"><Icon name="alert" size={20} /><span><b>Cancha 2 ocupada.</b> Lucas Benítez · 19:00–20:00</span></p>
            <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Reservar no genera un cobro.</span></p>
            <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Ya tenés 3 turnos activos.</span></p>
          </div>
        </div>
        <div className="system-row">
          <Button variant="primary" icon="checkCircle" onClick={() => notify({ tone: 'success', title: 'Reserva confirmada', body: 'Cancha 2 · 19:00–20:00' })}>Toast de éxito</Button>
          <Button variant="secondary" icon="alert" onClick={() => notify({ tone: 'error', title: 'No se pudo guardar', body: 'Reintentá sin miedo a duplicar.' })}>Toast de error</Button>
          <Button variant="secondary" icon="layers" onClick={() => setModal(true)}>Abrir modal</Button>
        </div>
      </section>

      <section className="system-section" aria-labelledby="ds-icons">
        <h2 id="ds-icons" className="section-title">Iconografía</h2>
        <ul className="icon-grid">
          {ICON_NAMES.map((name) => <li key={name}><Icon name={name} size={24} /><span>{name}</span></li>)}
        </ul>
      </section>

      <Modal open={modal} onClose={() => setModal(false)} title="Modal de ejemplo" eyebrow="Componente" footer={<div className="form-actions"><Button variant="ghost" onClick={() => setModal(false)}>Cerrar</Button><Button variant="accent" icon="check" onClick={() => setModal(false)}>Aceptar</Button></div>}>
        <p>En escritorio aparece centrado; en celular, como hoja inferior con el pulgar a mano. Escape, fondo y botón cierran. El foco queda atrapado dentro.</p>
      </Modal>
    </div>
  )
}
