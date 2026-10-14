import { useState } from 'react'
import { useProto, type DataState } from '../../lib/proto'
import type { RoutePath } from '../../lib/router'
import { useStore } from '../../lib/store'
import { Icon, SegmentedTabs, Switch } from '../ui'

/** Controles de revisión del prototipo. No forman parte del diseño de producto. */
export function ProtoPanel({ route, navigate }: { route: RoutePath; navigate: (path: RoutePath) => void }) {
  const { dataState, setDataState, failActions, setFailActions, notify } = useProto()
  const { dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const experience = route.startsWith('/jugador') ? 'player' : route === '/sistema' ? 'system' : route === '/acceso' ? 'access' : 'admin'

  return (
    <div className={`proto ${open ? 'is-open' : ''}`}>
      <button type="button" className="proto-toggle" aria-expanded={open} aria-controls="proto-panel" onClick={() => setOpen(!open)}>
        <Icon name="sliders" size={18} />
        <span>Prototipo</span>
        {dataState !== 'ok' || failActions ? <span className="proto-dot" aria-label="Simulación activa" /> : null}
      </button>
      {open && (
        <div className="proto-panel" id="proto-panel" role="region" aria-label="Controles del prototipo">
          <div className="proto-head">
            <strong>Controles de revisión</strong>
            <button type="button" className="icon-btn icon-btn-ghost icon-btn-sm" aria-label="Cerrar controles" onClick={() => setOpen(false)}><Icon name="x" size={18} /></button>
          </div>
          <p className="proto-label">Experiencia</p>
          <SegmentedTabs
            label="Experiencia"
            size="sm"
            stretch
            value={experience}
            onChange={(next) => navigate(next === 'player' ? '/jugador/inicio' : next === 'system' ? '/sistema' : next === 'access' ? '/acceso' : '/admin/inicio')}
            items={[{ id: 'admin', label: 'Admin' }, { id: 'player', label: 'Jugador' }, { id: 'access', label: 'Acceso' }, { id: 'system', label: 'Sistema' }]}
          />
          <p className="proto-label">Estado de los datos</p>
          <SegmentedTabs<DataState>
            label="Estado de los datos"
            size="sm"
            stretch
            value={dataState}
            onChange={setDataState}
            items={[{ id: 'ok', label: 'Normal' }, { id: 'loading', label: 'Carga' }, { id: 'empty', label: 'Vacío' }, { id: 'error', label: 'Error' }]}
          />
          <Switch checked={failActions} onChange={setFailActions} label="Simular fallo al guardar" description="Guardar, cobrar, inscribir o ingresar falla para ver el reintento." />
          <button type="button" className="menu-item" onClick={() => { dispatch({ type: 'reset' }); setDataState('ok'); setFailActions(false); notify({ tone: 'info', title: 'Datos ficticios reiniciados' }) }}>
            <Icon name="refresh" />Reiniciar datos ficticios
          </button>
          <p className="proto-foot">Datos 100 % ficticios · hora simulada 18:20 · sin conexión a Supabase.</p>
        </div>
      )}
    </div>
  )
}
