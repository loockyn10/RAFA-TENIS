import { useMemo, useState } from 'react'
import { balanceCents, CATEGORIES, NOW, PAYMENT_LABEL, PRODUCTS, productById, TODAY, type CategoryId, type PaymentMethod, type Product, type Sale } from '../../data/mock'
import { MethodPicker, PersonPicker } from '../../components/domain'
import { METHODS } from '../../lib/payments'
import { usePeople } from '../../lib/data'
import { formatARS, plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { dateShort, hhmm } from '../../lib/time'
import { Avatar, Badge, Button, Chip, EmptyState, ErrorState, Icon, IconButton, Modal, SegmentedTabs, SkeletonCards, Stepper, TextInput } from '../../components/ui'

type Tab = 'sell' | 'pending' | 'history'

export function Canteen() {
  const { state } = useStore()
  const { dataState, retry } = useScreenState()
  const [tab, setTab] = useState<Tab>('sell')
  const sales = dataState === 'empty' ? [] : state.sales
  const pendingPeople = new Set(sales.filter((sale) => balanceCents(sale) > 0).map((sale) => sale.personId)).size
  const collected = sales.flatMap((sale) => sale.payments).filter((payment) => payment.date === TODAY).reduce((sum, payment) => sum + payment.amountCents, 0)

  return (
    <div className="canteen">
      <div className="canteen-top">
        <SegmentedTabs
          label="Secciones de cantina"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'sell', label: 'Vender', icon: 'bolt' },
            { id: 'pending', label: 'A cuenta', icon: 'wallet', count: pendingPeople },
            { id: 'history', label: 'Hoy', icon: 'receipt' },
          ]}
        />
        <p className="canteen-kpi"><span>Cobrado hoy</span><strong className="num">{formatARS(collected)}</strong></p>
      </div>
      {dataState === 'error' ? <ErrorState title="No pudimos cargar la cantina" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={4} height={96} />
          : tab === 'sell' ? <SellView empty={dataState === 'empty'} />
            : tab === 'pending' ? <PendingView sales={sales} />
              : <HistoryView sales={sales} />}
    </div>
  )
}

// ── Vender ──────────────────────────────────────────────────────────
function SellView({ empty }: { empty: boolean }) {
  const { state, dispatch } = useStore()
  const [category, setCategory] = useState<CategoryId | 'top'>('top')
  const [query, setQuery] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const catalog = empty ? [] : PRODUCTS
  const visible = catalog.filter((product) => {
    if (query.trim()) return product.name.toLowerCase().includes(query.trim().toLowerCase())
    return category === 'top' ? product.popular : product.categoryId === category
  })
  const qtyOf = (id: string) => state.cart.find((line) => line.productId === id)?.qty ?? 0
  const count = state.cart.reduce((sum, line) => sum + line.qty, 0)
  const total = cartTotal(state.cart)

  return (
    <div className="sell">
      <section className="sell-catalog" aria-label="Productos">
        <div className="sell-filters">
          <TextInput icon="search" type="search" placeholder="Buscar producto" aria-label="Buscar producto" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="chip-row chip-row-scroll">
            <Chip selected={category === 'top' && !query} icon="bolt" onClick={() => { setCategory('top'); setQuery('') }}>Más vendidos</Chip>
            {CATEGORIES.map((item) => <Chip key={item.id} selected={category === item.id && !query} onClick={() => { setCategory(item.id); setQuery('') }}>{item.name}</Chip>)}
          </div>
        </div>
        {visible.length === 0 ? (
          <EmptyState icon="search" title={empty ? 'Todavía no hay productos' : 'Sin resultados'} body={empty ? 'El catálogo se arma desde Configuración de cantina.' : 'Probá con otro nombre o categoría.'} />
        ) : (
          <ul className="product-grid">
            {visible.map((product) => <ProductTile key={product.id} product={product} qty={qtyOf(product.id)} onAdd={() => dispatch({ type: 'cart/add', productId: product.id })} />)}
          </ul>
        )}
      </section>

      <aside className="sell-ticket" aria-label="Venta actual">
        <Ticket />
      </aside>

      {count > 0 && (
        <button type="button" className="cart-bar" onClick={() => setCartOpen(true)}>
          <span className="cart-bar-count num">{count}</span>
          <span className="cart-bar-label">Ver venta</span>
          <strong className="num">{formatARS(total)}</strong>
          <Icon name="chevronRight" size={20} />
        </button>
      )}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Venta actual" size="md">
        <Ticket inSheet onDone={() => setCartOpen(false)} />
      </Modal>
    </div>
  )
}

function cartTotal(cart: { productId: string; qty: number }[]) {
  return cart.reduce((sum, line) => sum + line.qty * (productById(line.productId)?.priceCents ?? 0), 0)
}

function ProductTile({ product, qty, onAdd }: { product: Product; qty: number; onAdd: () => void }) {
  return (
    <li>
      <button type="button" className={`product-tile tone-${product.categoryId} ${qty > 0 ? 'in-cart' : ''}`} onClick={onAdd} aria-label={`Agregar ${product.name}, ${formatARS(product.priceCents)}${qty ? `. En la venta: ${qty}` : ''}`}>
        <span className="product-icon"><Icon name={product.icon} size={26} /></span>
        <span className="product-name">{product.name}</span>
        {product.detail && <span className="product-detail">{product.detail}</span>}
        <span className="product-price display num">{formatARS(product.priceCents)}</span>
        {qty > 0 ? <span className="product-qty num" aria-hidden="true">{qty}</span> : <span className="product-add" aria-hidden="true"><Icon name="plus" size={18} /></span>}
      </button>
    </li>
  )
}

function Ticket({ inSheet = false, onDone }: { inSheet?: boolean; onDone?: () => void }) {
  const { state, dispatch } = useStore()
  const { simulate, notify } = useProto()
  const { byId: personById } = usePeople()
  const [picker, setPicker] = useState<null | 'assign' | 'account'>(null)
  const [checkout, setCheckout] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const total = cartTotal(state.cart)
  const person = personById(state.cartPersonId)
  const count = state.cart.reduce((sum, line) => sum + line.qty, 0)

  const confirm = async (mode: 'paid' | 'account', method: PaymentMethod | null, personId: string | null) => {
    setStatus('saving')
    try {
      await simulate()
    } catch {
      setStatus('error')
      // El cobro muestra el error dentro del modal; «Anotar a cuenta» no tiene modal propio.
      if (mode === 'account') notify({ tone: 'error', title: 'No se pudo anotar el consumo', body: 'La venta actual se conserva. Reintentá sin miedo a duplicarla.' })
      return
    }
    const sale: Sale = {
      id: `s-new-${Date.now()}`,
      date: TODAY,
      time: NOW,
      lines: state.cart.map((line) => { const product = productById(line.productId)!; return { productId: product.id, name: product.name, qty: line.qty, unitCents: product.priceCents } }),
      totalCents: total,
      personId: personId ?? undefined,
      payments: mode === 'paid' && method ? [{ amountCents: total, method, date: TODAY }] : [],
    }
    dispatch({ type: 'sale/add', sale })
    dispatch({ type: 'cart/clear' })
    setStatus('idle')
    setCheckout(false)
    setPicker(null)
    notify({ tone: 'success', title: mode === 'paid' ? `Cobrado ${formatARS(total)}` : `Anotado a ${personById(personId)?.name}`, body: mode === 'paid' && method ? PAYMENT_LABEL[method] : 'Queda como consumo a cuenta.' })
    onDone?.()
  }

  if (state.cart.length === 0) {
    return (
      <div className={`ticket ${inSheet ? 'ticket-sheet' : ''}`}>
        {!inSheet && <TicketHead count={0} />}
        <EmptyState icon="cart" title="Venta vacía" body="Tocá un producto para empezar. Podés cobrar al instante o anotarlo a cuenta." />
      </div>
    )
  }

  return (
    <div className={`ticket ${inSheet ? 'ticket-sheet' : ''}`}>
      {!inSheet && <TicketHead count={count} onClear={() => dispatch({ type: 'cart/clear' })} />}
      <ul className="ticket-lines">
        {state.cart.map((line) => {
          const product = productById(line.productId)!
          return (
            <li key={line.productId} className="ticket-line">
              <span className="ticket-line-name">{product.name}<small className="num">{formatARS(product.priceCents)} c/u</small></span>
              <Stepper value={line.qty} label={product.name} onChange={(qty) => dispatch({ type: 'cart/set', productId: line.productId, qty })} />
              <strong className="ticket-line-total num">{formatARS(product.priceCents * line.qty)}</strong>
            </li>
          )
        })}
      </ul>
      <div className="ticket-customer">
        {person ? (
          <div className="person-pill">
            <Avatar name={person.name} size="sm" />
            <span className="person-pill-name">{person.name}</span>
            <IconButton icon="x" size="sm" label="Quitar persona" onClick={() => dispatch({ type: 'cart/person', personId: null })} />
          </div>
        ) : (
          <button type="button" className="link-btn link-btn-icon" onClick={() => setPicker('assign')}><Icon name="user" size={18} />Asignar persona <span className="muted">(opcional)</span></button>
        )}
      </div>
      <div className="ticket-total">
        <span>Total</span>
        <strong className="display num">{formatARS(total)}</strong>
      </div>
      <div className="ticket-actions">
        <Button variant="accent" size="lg" block icon="cash" onClick={() => { setStatus('idle'); setCheckout(true) }}>Cobrar</Button>
        <Button variant="secondary" block icon="note" onClick={() => (person ? void confirm('account', null, person.id) : setPicker('account'))} loading={status === 'saving' && !checkout}>Anotar a cuenta</Button>
        {inSheet && <Button variant="ghost" block icon="trash" onClick={() => { dispatch({ type: 'cart/clear' }); onDone?.() }}>Vaciar venta</Button>}
      </div>

      <CheckoutModal open={checkout} total={total} status={status} onClose={() => setCheckout(false)} onConfirm={(method) => void confirm('paid', method, person?.id ?? null)} />
      <PersonPicker
        open={picker !== null}
        title={picker === 'account' ? '¿A quién se anota?' : 'Asignar persona'}
        hint={picker === 'account' ? 'Un consumo a cuenta necesita una ficha.' : undefined}
        allowCreate
        onClose={() => setPicker(null)}
        onPick={(id) => {
          dispatch({ type: 'cart/person', personId: id })
          if (picker === 'account') void confirm('account', null, id)
          else setPicker(null)
        }}
      />
    </div>
  )
}

function TicketHead({ count, onClear }: { count: number; onClear?: () => void }) {
  return (
    <header className="ticket-head">
      <div>
        <p className="eyebrow">Venta actual</p>
        <strong>{count ? plural(count, 'producto', 'productos') : 'Sin productos'}</strong>
      </div>
      {onClear && <Button variant="ghost" size="sm" icon="trash" onClick={onClear}>Vaciar</Button>}
    </header>
  )
}

function CheckoutModal({ open, total, status, onClose, onConfirm }: { open: boolean; total: number; status: 'idle' | 'saving' | 'error'; onClose: () => void; onConfirm: (method: PaymentMethod) => void }) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={status === 'saving'}
      size="sm"
      eyebrow="Cobrar venta"
      title={<span className="num">{formatARS(total)}</span>}
      footer={
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={status === 'saving'}>Volver</Button>
          <Button variant="accent" size="lg" icon={status === 'error' ? 'refresh' : 'check'} loading={status === 'saving'} onClick={() => onConfirm(method)}>
            {status === 'error' ? 'Reintentar' : 'Confirmar cobro'}
          </Button>
        </div>
      }
    >
      <fieldset className="form-block">
        <legend className="form-legend">Medio de pago</legend>
        <MethodPicker value={method} onChange={setMethod} autoFocus />
      </fieldset>
      {status === 'error' && (
        <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se confirmó el cobro</strong><p>La venta sigue abierta. Reintentar no la duplica.</p></div></div>
      )}
    </Modal>
  )
}

// ── A cuenta (consumos pendientes) ──────────────────────────────────
function PendingView({ sales }: { sales: Sale[] }) {
  const { dispatch } = useStore()
  const { simulate, notify } = useProto()
  const { byId: personById } = usePeople()
  const [query, setQuery] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  const accounts = useMemo(() => {
    const map = new Map<string, Sale[]>()
    sales.filter((sale) => sale.personId && balanceCents(sale) > 0).forEach((sale) => map.set(sale.personId!, [...(map.get(sale.personId!) ?? []), sale]))
    return [...map.entries()]
      .map(([id, items]) => ({ person: personById(id)!, items, total: items.reduce((sum, sale) => sum + balanceCents(sale), 0) }))
      .filter((account) => account.person.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.total - a.total)
  }, [sales, query, personById])
  const open = accounts.find((account) => account.person.id === personId)

  const payAll = async () => {
    if (!open) return
    setStatus('saving')
    try { await simulate() } catch { setStatus('error'); return }
    dispatch({ type: 'sale/payAll', personId: open.person.id, method })
    notify({ tone: 'success', title: `Pago registrado · ${formatARS(open.total)}`, body: `${open.person.name} · ${PAYMENT_LABEL[method]}` })
    setStatus('idle')
    setPersonId(null)
  }

  return (
    <section className="pending" aria-label="Consumos a cuenta">
      <div className="pending-toolbar">
        <TextInput icon="search" type="search" placeholder="Buscar persona" aria-label="Buscar persona" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="muted">{plural(accounts.length, 'persona', 'personas')} · {formatARS(accounts.reduce((sum, account) => sum + account.total, 0))}</p>
      </div>
      {accounts.length === 0 ? (
        <EmptyState icon="checkCircle" title="Nadie debe consumos" body="Cuando anotes una venta a cuenta aparecerá acá." />
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.person.id}>
              <button type="button" className="account-row" onClick={() => { setStatus('idle'); setPersonId(account.person.id) }}>
                <Avatar name={account.person.name} />
                <span className="account-row-main">
                  <strong>{account.person.name}</strong>
                  <span>{plural(account.items.length, 'consumo', 'consumos')} · desde {dateShort(account.items.map((sale) => sale.date).sort()[0])}</span>
                </span>
                <strong className="account-row-amount num">{formatARS(account.total)}</strong>
                <Icon name="chevronRight" size={18} className="row-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open !== undefined}
        onClose={() => setPersonId(null)}
        busy={status === 'saving'}
        variant="drawer"
        size="sm"
        eyebrow="Consumos a cuenta"
        title={open?.person.name ?? ''}
        footer={open && (
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setPersonId(null)} disabled={status === 'saving'}>Cerrar</Button>
            <Button variant="accent" size="lg" icon={status === 'error' ? 'refresh' : 'check'} loading={status === 'saving'} onClick={() => void payAll()}>
              {status === 'error' ? 'Reintentar' : `Cobrar ${formatARS(open.total)}`}
            </Button>
          </div>
        )}
      >
        {open && (
          <div className="detail">
            <ul className="sale-list">
              {open.items.map((sale) => <SaleRow key={sale.id} sale={sale} showBalance />)}
            </ul>
            <fieldset className="form-block">
              <legend className="form-legend">Medio de pago</legend>
              <div className="chip-row">
                {METHODS.map((item) => <Chip key={item.id} icon={item.icon} selected={method === item.id} onClick={() => setMethod(item.id)}>{PAYMENT_LABEL[item.id]}</Chip>)}
              </div>
            </fieldset>
            <p className="detail-footnote"><Icon name="info" size={16} />Se registra un pago por cada consumo. Los pagos parciales se cargan desde el consumo.</p>
            {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se registró el pago</strong><p>El saldo no cambió. Reintentá.</p></div></div>}
          </div>
        )}
      </Modal>
    </section>
  )
}

// ── Historial del día ───────────────────────────────────────────────
function HistoryView({ sales }: { sales: Sale[] }) {
  const today = sales.filter((sale) => sale.date === TODAY).sort((a, b) => b.time - a.time)
  if (today.length === 0) return <EmptyState icon="receipt" title="Todavía no hay ventas hoy" body="Las ventas confirmadas se listan acá con su estado de pago." />
  return (
    <section aria-label="Ventas de hoy">
      <ul className="sale-list sale-list-card">
        {today.map((sale) => <SaleRow key={sale.id} sale={sale} />)}
      </ul>
    </section>
  )
}

function SaleRow({ sale, showBalance = false }: { sale: Sale; showBalance?: boolean }) {
  const balance = balanceCents(sale)
  const person = usePeople().byId(sale.personId)
  const method = sale.payments.at(-1)?.method
  return (
    <li className={`sale-row ${sale.voided ? 'is-voided' : ''}`}>
      <span className="sale-time num">{sale.date === TODAY ? hhmm(sale.time) : dateShort(sale.date)}</span>
      <span className="sale-main">
        <strong>{sale.lines.map((line) => `${line.qty > 1 ? `${line.qty}× ` : ''}${line.name}`).join(', ')}</strong>
        <span>{person ? person.name : 'Venta anónima'}</span>
      </span>
      <span className="sale-side">
        <strong className="num">{formatARS(showBalance ? balance : sale.totalCents)}</strong>
        {sale.voided ? <Badge tone="neutral">Anulada</Badge>
          : balance === 0 ? <Badge tone="success" icon="check">{method ? PAYMENT_LABEL[method] : 'Cobrada'}</Badge>
            : balance < sale.totalCents ? <Badge tone="warning">Pago parcial</Badge>
              : <Badge tone="clay">A cuenta</Badge>}
      </span>
    </li>
  )
}
