import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanteenCategory, CanteenProduct, CanteenSale, CanteenSaleItem, CanteenSalePayment, Club, ClubPerson, PaymentMethod } from '../../types/domain'
import { formatArs, parseArsToCents, todayInClubTimezone } from '../fees/feeUtils'
import { KEY_CONFLICT_MESSAGE, UNCERTAIN_RESULT_MESSAGE, operationFingerprint, releaseOperationKey, runIdempotentOperation } from '../../lib/idempotency'
import { Avatar, Badge, Button, Chip, EmptyState, Field, Icon, Modal, MoneyInput, SegmentedTabs, SelectInput, Stepper, StatStrip, Switch, TextArea, TextInput, type IconName, type Stat } from '../../design/ui'
import { MethodPicker } from '../../design/domain'
import { PAYMENT_LABELS } from '../../design/paymentLabels'
import { plural } from '../../design/format'
import { addToCart, balanceForSale, cartTotalCents, changeCartQuantity, paidForSale, saleStatus, type CartLine } from './canteenUtils'

type CanteenView = 'sell' | 'pending' | 'history' | 'catalog'
type CheckoutMode = 'paid' | 'pending'
type ProductForm = { name: string; categoryId: string; price: string; active: boolean }
type CategoryForm = { name: string; active: boolean }
const productFields = 'id, club_id, category_id, name, sale_price_cents, active, created_at, updated_at'
const categoryFields = 'id, club_id, name, active, created_at, updated_at'
const saleFields = 'id, club_id, customer_person_id, total_cents, status, client_request_id, created_at, created_by, voided_at, voided_by, void_reason'
const itemFields = 'id, club_id, sale_id, product_id, product_name_snapshot, quantity, unit_price_cents, created_at'
const paymentFields = 'id, club_id, sale_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by'
const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'
const paymentLabels = PAYMENT_LABELS

function errorText(error: unknown, fallback: string) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : fallback
}
function dateTime(value: string, timezone: string) { return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
function dateInTimezone(value: string, timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) }
function statusLabel(status: ReturnType<typeof saleStatus>) { return status === 'pending' ? 'Pendiente' : status === 'partial' ? 'Parcial' : status === 'paid' ? 'Pagada' : 'Anulada' }

export function PersonCanteenAccount({ client, club, personId }: { client: SupabaseClient; club: Club; personId: string }) {
  const [sales, setSales] = useState<CanteenSale[]>([])
  const [payments, setPayments] = useState<CanteenSalePayment[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data: saleRows, error } = await client.from('canteen_sales').select(saleFields).eq('club_id', club.id).eq('customer_person_id', personId).order('created_at', { ascending: false }).limit(50)
      const nextSales = (saleRows ?? []) as CanteenSale[]
      const { data: paymentRows } = error || nextSales.length === 0 ? { data: [] } : await client.from('canteen_sale_payments').select(paymentFields).eq('club_id', club.id).in('sale_id', nextSales.map((sale) => sale.id))
      if (!cancelled) { setSales(error ? [] : nextSales); setPayments((paymentRows ?? []) as CanteenSalePayment[]); setLoading(false) }
    }
    void load(); return () => { cancelled = true }
  }, [client, club.id, personId])
  const pending = sales.reduce((total, sale) => total + balanceForSale(sale, payments), 0)
  return (
    <section className="detail-section" aria-labelledby="pc-title">
      <h3 id="pc-title" className="detail-section-title">Consumos de cantina</h3>
      {loading ? <p className="muted">Cargando consumos…</p> : sales.length === 0 ? <p className="muted">No hay consumos de cantina asociados.</p> : (
        <>
          <div className="balance-grid">
            <div className={`balance ${pending ? 'is-due' : ''}`}>
              <span>Saldo pendiente de cantina</span>
              <strong className="display num">{pending ? formatArs(pending) : 'Al día'}</strong>
              <small>{pending ? 'Consumos a cuenta' : 'Sin consumos pendientes'}</small>
            </div>
          </div>
          <ul className="mini-list">
            {sales.map((sale) => (
              <li key={sale.id}>
                <span>{dateTime(sale.created_at, club.timezone)}</span>
                <span className="num">{formatArs(sale.total_cents)}{paidForSale(sale.id, payments) > 0 ? ` · cobrado ${formatArs(paidForSale(sale.id, payments))}` : ''}</span>
                <Badge tone={STATUS_TONE[saleStatus(sale, payments)]}>{statusLabel(saleStatus(sale, payments))}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function CanteenPanel({ client, club, canManageCatalog }: { client: SupabaseClient; club: Club; canManageCatalog: boolean }) {
  const [view, setView] = useState<CanteenView>('sell')
  const [categories, setCategories] = useState<CanteenCategory[]>([])
  const [products, setProducts] = useState<CanteenProduct[]>([])
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [sales, setSales] = useState<CanteenSale[]>([])
  const [items, setItems] = useState<CanteenSaleItem[]>([])
  const [payments, setPayments] = useState<CanteenSalePayment[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('top')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('paid')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [productEditor, setProductEditor] = useState<CanteenProduct | 'new' | null>(null)
  const [categoryEditor, setCategoryEditor] = useState<CanteenCategory | 'new' | null>(null)
  const [paymentSale, setPaymentSale] = useState<CanteenSale | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayInClubTimezone(club.timezone))
  const [paymentMethodLater, setPaymentMethodLater] = useState<PaymentMethod>('cash')
  const [voidSale, setVoidSale] = useState<CanteenSale | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  // Operaciones financieras: una sola en vuelo a la vez (el botón deshabilitado no alcanza ante un doble clic rápido).
  const sendingRef = useRef(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutUncertain, setCheckoutUncertain] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentUncertain, setPaymentUncertain] = useState(false)

  const load = async () => {
    setLoading(true)
    const [categoryResult, productResult, peopleResult, salesResult] = await Promise.all([
      client.from('canteen_categories').select(categoryFields).eq('club_id', club.id).order('name'),
      client.from('canteen_products').select(productFields).eq('club_id', club.id).order('name'),
      client.from('club_people').select(personFields).eq('club_id', club.id).order('full_name').limit(150),
      client.from('canteen_sales').select(saleFields).eq('club_id', club.id).order('created_at', { ascending: false }).limit(150),
    ])
    if (categoryResult.error || productResult.error || peopleResult.error || salesResult.error) setFeedback('No pudimos cargar toda la información de cantina. Intentá recargar.')
    const nextSales = (salesResult.data ?? []) as CanteenSale[]
    const [itemResult, paymentResult] = nextSales.length === 0 ? [{ data: [] }, { data: [] }] : await Promise.all([
      client.from('canteen_sale_items').select(itemFields).eq('club_id', club.id).in('sale_id', nextSales.map((sale) => sale.id)),
      client.from('canteen_sale_payments').select(paymentFields).eq('club_id', club.id).in('sale_id', nextSales.map((sale) => sale.id)),
    ])
    setCategories((categoryResult.data ?? []) as CanteenCategory[]); setProducts((productResult.data ?? []) as CanteenProduct[]); setPeople((peopleResult.data ?? []) as ClubPerson[])
    setSales(nextSales); setItems((itemResult.data ?? []) as CanteenSaleItem[]); setPayments((paymentResult.data ?? []) as CanteenSalePayment[]); setLoading(false)
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id])

  useEffect(() => { setEditorError(null) }, [productEditor, categoryEditor, voidSale])

  const topProductIds = useMemo(() => {
    const sold = new Map<string, number>()
    for (const item of items) sold.set(item.product_id, (sold.get(item.product_id) ?? 0) + item.quantity)
    return new Set([...sold.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => products.some((product) => product.id === id && product.active)).slice(0, 8))
  }, [items, products])
  // «Más vendidos» solo cuando hay historial suficiente para que el ranking tenga sentido; si no, se muestra todo el catálogo.
  const hasTop = topProductIds.size >= 3
  const activeFilter = categoryFilter === 'top' && !hasTop ? 'all' : categoryFilter
  const visibleProducts = useMemo(() => products.filter((product) => product.active && (search.trim() !== '' || activeFilter === 'all' || (activeFilter === 'top' ? topProductIds.has(product.id) : product.category_id === activeFilter)) && product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())), [products, activeFilter, search, topProductIds])
  const selectedCustomer = people.find((person) => person.id === customerId) ?? null
  const matchingPeople = people.filter((person) => person.active && person.full_name.toLocaleLowerCase().includes(customerSearch.toLocaleLowerCase().trim())).slice(0, 8)
  const personById = new Map(people.map((person) => [person.id, person]))
  const pendingSales = sales.filter((sale) => sale.status === 'confirmed' && balanceForSale(sale, payments) > 0 && (pendingSearch.trim() === '' || (sale.customer_person_id ? personById.get(sale.customer_person_id)?.full_name.toLocaleLowerCase().includes(pendingSearch.toLocaleLowerCase().trim()) : false)))
  const today = todayInClubTimezone(club.timezone)
  const stats = useMemo(() => ({ sold: sales.filter((sale) => sale.status === 'confirmed' && dateInTimezone(sale.created_at, club.timezone) === today).reduce((sum, sale) => sum + sale.total_cents, 0), collected: payments.filter((payment) => payment.payment_date === today).reduce((sum, payment) => sum + payment.amount_cents, 0), pending: sales.reduce((sum, sale) => sum + balanceForSale(sale, payments), 0) }), [sales, payments, today, club.timezone])

  const addProduct = (product: CanteenProduct) => setCart((current) => addToCart(current, { productId: product.id, name: product.name, unitPriceCents: product.sale_price_cents }))
  const saleScope = `canteen-sale:${club.id}`
  const openCheckout = (mode: CheckoutMode = 'paid') => { if (cart.length > 0) { setCheckoutMode(mode); setCustomerId(null); setCustomerSearch(''); setCheckoutError(null); setCheckoutUncertain(false); setCheckoutOpen(true) } }
  // «Vaciar» es la decisión explícita de empezar una venta nueva: recién ahí se descarta la identidad de la anterior.
  const clearCart = () => { setCart([]); setCartOpen(false); releaseOperationKey(saleScope); setCheckoutError(null); setCheckoutUncertain(false) }
  const createQuickPerson = async () => {
    const name = customerSearch.trim(); if (!name) return
    const { data, error } = await client.from('club_people').insert({ club_id: club.id, full_name: name, active: true }).select(personFields).single()
    if (error) return setFeedback('No pudimos crear la persona. Intentá nuevamente.')
    const person = data as ClubPerson; setPeople((current) => [...current, person].sort((a, b) => a.full_name.localeCompare(b.full_name))); setCustomerId(person.id); setCustomerSearch('')
  }
  const confirmSale = async () => {
    if (sendingRef.current || cart.length === 0 || (checkoutMode === 'pending' && !customerId)) return
    sendingRef.current = true; setSaving(true); setFeedback(null); setCheckoutError(null)
    const items = cart.map((line) => ({ product_id: line.productId, quantity: line.quantity }))
    const customer = checkoutMode === 'pending' ? customerId : null
    const method = checkoutMode === 'paid' ? paymentMethod : null
    // La clave se genera una vez por carrito: un reintento (o una recarga con el mismo carrito) reutiliza la identidad
    // de la operación; si cambia el carrito, el cliente o el medio de pago es otra venta y recibe otra clave.
    const outcome = await runIdempotentOperation<CanteenSale>({
      scope: saleScope,
      fingerprint: operationFingerprint({ items: [...items].sort((a, b) => (a.product_id < b.product_id ? -1 : 1)), customer, method }),
      call: (key, signal) => client.rpc('create_canteen_sale', { p_club_id: club.id, p_items: items, p_customer_person_id: customer, p_payment_method: method, p_client_request_id: key }).abortSignal(signal),
      recover: async (key) => {
        const { data, error } = await client.from('canteen_sales').select(saleFields).eq('club_id', club.id).eq('client_request_id', key).maybeSingle()
        if (error) throw error
        return data as CanteenSale | null
      },
    })
    sendingRef.current = false; setSaving(false)
    if (outcome.status === 'ok') {
      setCheckoutUncertain(false); setCart([]); setCheckoutOpen(false); setCartOpen(false)
      setFeedback(outcome.data?.status === 'voided' ? 'Esta venta ya se había registrado y luego fue anulada. No se registró otra.' : outcome.recovered ? 'La venta ya estaba registrada: la recuperamos sin duplicarla.' : 'Venta registrada correctamente.')
      await load(); return
    }
    setCheckoutUncertain(outcome.status === 'uncertain')
    setCheckoutError(outcome.status === 'uncertain' ? UNCERTAIN_RESULT_MESSAGE : outcome.status === 'conflict' ? KEY_CONFLICT_MESSAGE : errorText({ message: outcome.message }, 'No pudimos confirmar la venta.'))
  }
  const saveProduct = async (form: ProductForm) => {
    const price = parseArsToCents(form.price); if (!form.name.trim() || !form.categoryId || price === null) return setEditorError('Completá nombre, categoría y un precio válido mayor a cero.')
    const payload = { name: form.name.trim(), category_id: form.categoryId, sale_price_cents: price, active: form.active }
    const result = productEditor === 'new' ? await client.from('canteen_products').insert({ club_id: club.id, ...payload }) : await client.from('canteen_products').update(payload).eq('id', productEditor?.id ?? '').eq('club_id', club.id)
    if (result.error) return setEditorError(errorText(result.error, 'No pudimos guardar el producto.'))
    setProductEditor(null); await load()
  }
  const saveCategory = async (form: CategoryForm) => {
    if (!form.name.trim()) return setEditorError('Indicá un nombre para la categoría.')
    const payload = { name: form.name.trim(), active: form.active }
    const result = categoryEditor === 'new' ? await client.from('canteen_categories').insert({ club_id: club.id, ...payload }) : await client.from('canteen_categories').update(payload).eq('id', categoryEditor?.id ?? '').eq('club_id', club.id)
    if (result.error) return setEditorError(errorText(result.error, 'No pudimos guardar la categoría.'))
    setCategoryEditor(null); await load()
  }
  const recordPayment = async () => {
    if (!paymentSale || sendingRef.current) return
    const amount = parseArsToCents(paymentAmount); if (amount === null) return setPaymentError('Indicá un importe válido mayor a cero.')
    const sale = paymentSale
    sendingRef.current = true; setSaving(true); setPaymentError(null)
    const outcome = await runIdempotentOperation<CanteenSalePayment>({
      scope: `canteen-payment:${club.id}:${sale.id}`,
      fingerprint: operationFingerprint({ amount, paymentDate, method: paymentMethodLater }),
      call: (key, signal) => client.rpc('record_canteen_sale_payment', { p_club_id: club.id, p_sale_id: sale.id, p_amount_cents: amount, p_payment_date: paymentDate, p_payment_method: paymentMethodLater, p_reference: null, p_notes: null, p_client_request_id: key }).abortSignal(signal),
      recover: async (key) => {
        const { data, error } = await client.from('canteen_sale_payments').select(paymentFields).eq('club_id', club.id).eq('client_request_id', key).maybeSingle()
        if (error) throw error
        return data as CanteenSalePayment | null
      },
    })
    sendingRef.current = false; setSaving(false)
    if (outcome.status === 'ok') { setPaymentUncertain(false); setPaymentSale(null); setFeedback(outcome.recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.'); await load(); return }
    setPaymentUncertain(outcome.status === 'uncertain')
    setPaymentError(outcome.status === 'uncertain' ? UNCERTAIN_RESULT_MESSAGE : outcome.status === 'conflict' ? KEY_CONFLICT_MESSAGE : errorText({ message: outcome.message }, 'No pudimos registrar el pago.'))
  }
  const voidCurrentSale = async () => {
    if (!voidSale || !voidReason.trim()) return setEditorError('Indicá el motivo de la anulación.')
    setSaving(true); const { error } = await client.rpc('void_canteen_sale', { p_sale_id: voidSale.id, p_reason: voidReason }); setSaving(false)
    if (error) return setEditorError(errorText(error, 'No pudimos anular la venta.'))
    setVoidSale(null); setVoidReason(''); setFeedback('Venta anulada.'); await load()
  }

  const pendingCount = sales.filter((sale) => sale.status === 'confirmed' && balanceForSale(sale, payments) > 0).length
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0)
  const cartTotal = cartTotalCents(cart)
  const startPayment = (sale: CanteenSale) => { setPaymentSale(sale); setPaymentError(null); setPaymentUncertain(false); setPaymentAmount(String(balanceForSale(sale, payments) / 100).replace('.', ',')); setPaymentDate(today) }
  const changeQuantity = (productId: string, quantity: number) => setCart((current) => changeCartQuantity(current, productId, quantity))
  const tabs: { id: CanteenView; label: string; icon: IconName; count?: number }[] = [
    { id: 'sell', label: 'Vender', icon: 'bolt' },
    { id: 'pending', label: 'Consumos pendientes', icon: 'wallet', count: pendingCount || undefined },
    { id: 'history', label: 'Historial', icon: 'receipt' },
    ...(canManageCatalog ? [{ id: 'catalog' as const, label: 'Productos', icon: 'list' as const }] : []),
  ]
  const statItems: Stat[] = [
    { id: 'sold', label: 'Ventas de hoy', value: formatArs(stats.sold) },
    { id: 'collected', label: 'Cobrado hoy', value: formatArs(stats.collected), tone: 'green' },
    { id: 'pending', label: 'Saldo pendiente', value: formatArs(stats.pending), tone: 'clay' },
  ]
  const feedbackIsError = feedback !== null && /^(No |Completá|Indicá|Uno de)/.test(feedback)

  return <section className="canteen" aria-label="Cantina">
    <div className="canteen-top">
      <SegmentedTabs label="Secciones de cantina" value={view} onChange={(next) => { setFeedback(null); setView(next) }} items={tabs} />
    </div>
    {canManageCatalog && <StatStrip label="Resumen del día" items={statItems} />}
    {feedback && <p className={`inline-alert ${feedbackIsError ? 'inline-alert-danger' : 'inline-alert-success'}`} role={feedbackIsError ? 'alert' : 'status'}><Icon name={feedbackIsError ? 'alert' : 'checkCircle'} size={20} /><span>{feedback}</span></p>}
    {loading ? <p className="inline-alert inline-alert-info" role="status"><Icon name="info" size={20} /><span>Cargando cantina…</span></p> : <>
      {view === 'sell' && <div className="sell">
        <section className="sell-catalog" aria-label="Productos">
          <div className="sell-filters">
            <TextInput icon="search" type="search" placeholder="Buscar producto (gaseosa, pelota…)" aria-label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="chip-row chip-row-scroll" role="group" aria-label="Categoría">
              {hasTop && <Chip selected={activeFilter === 'top' && !search} icon="bolt" onClick={() => { setCategoryFilter('top'); setSearch('') }}>Más vendidos</Chip>}
              <Chip selected={activeFilter === 'all' && !search} onClick={() => { setCategoryFilter('all'); setSearch('') }}>Todos</Chip>
              {categories.filter((category) => category.active).map((category) => <Chip key={category.id} selected={activeFilter === category.id && !search} onClick={() => { setCategoryFilter(category.id); setSearch('') }}>{category.name}</Chip>)}
            </div>
          </div>
          {visibleProducts.length === 0 ? <EmptyState icon="search" title={products.some((product) => product.active) ? 'Sin resultados' : 'Todavía no hay productos'} body={products.some((product) => product.active) ? 'No hay productos activos para este filtro.' : canManageCatalog ? 'Cargá productos desde la pestaña Productos.' : 'El catálogo lo carga una persona administradora.'} /> : (
            <ul className="pos-grid">
              {visibleProducts.map((product) => {
                const qty = cart.find((line) => line.productId === product.id)?.quantity ?? 0
                const tone = productTone(categories.find((category) => category.id === product.category_id)?.name ?? '')
                return (
                  <li key={product.id}>
                    <button type="button" className={`product-tile tone-${tone.tone} ${qty > 0 ? 'in-cart' : ''}`} onClick={() => addProduct(product)} aria-label={`Agregar ${product.name}, ${formatArs(product.sale_price_cents)}${qty ? `. En la venta: ${qty}` : ''}`}>
                      <span className="product-icon"><Icon name={tone.icon} size={26} /></span>
                      <span className="product-name">{product.name}</span>
                      <span className="product-price display num">{formatArs(product.sale_price_cents)}</span>
                      {qty > 0 ? <span className="product-qty num" aria-hidden="true">{qty}</span> : <span className="product-add" aria-hidden="true"><Icon name="plus" size={18} /></span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <aside className="sell-ticket" aria-label="Venta actual"><Ticket cart={cart} saving={saving} onClear={clearCart} onQuantity={changeQuantity} onConfirm={openCheckout} /></aside>
        {cartCount > 0 && <button type="button" className="cart-bar" onClick={() => setCartOpen(true)}><span className="cart-bar-count num">{cartCount}</span><span className="cart-bar-label">Ver venta</span><strong className="num">{formatArs(cartTotal)}</strong><Icon name="chevronRight" size={20} /></button>}
        <Modal open={cartOpen && cart.length > 0} onClose={() => setCartOpen(false)} title="Venta actual" size="md"><Ticket inSheet cart={cart} saving={saving} onClear={clearCart} onQuantity={changeQuantity} onConfirm={openCheckout} /></Modal>
      </div>}
      {view === 'pending' && <PendingSales sales={pendingSales} people={personById} payments={payments} items={items} timezone={club.timezone} search={pendingSearch} onSearch={setPendingSearch} onPay={startPayment} />}
      {view === 'history' && <SalesHistory sales={sales} people={personById} items={items} payments={payments} timezone={club.timezone} canVoid={canManageCatalog} onPay={startPayment} onVoid={(sale) => setVoidSale(sale)} />}
      {view === 'catalog' && canManageCatalog && <Catalog categories={categories} products={products} onNewProduct={() => setProductEditor('new')} onEditProduct={setProductEditor} onNewCategory={() => setCategoryEditor('new')} onEditCategory={setCategoryEditor} />}
    </>}
    {checkoutOpen && <CheckoutDialog cartTotal={cartTotalCents(cart)} mode={checkoutMode} paymentMethod={paymentMethod} selectedCustomer={selectedCustomer} customerSearch={customerSearch} matchingPeople={matchingPeople} saving={saving} error={checkoutError} uncertain={checkoutUncertain} onClose={() => setCheckoutOpen(false)} onModeChange={setCheckoutMode} onPaymentMethod={setPaymentMethod} onSearch={setCustomerSearch} onSelect={(person) => { setCustomerId(person.id); setCustomerSearch('') }} onClear={() => setCustomerId(null)} onQuickCreate={() => void createQuickPerson()} onConfirm={() => void confirmSale()} />}
    {productEditor && <ProductDialog product={productEditor === 'new' ? undefined : productEditor} categories={categories} error={editorError} onClose={() => setProductEditor(null)} onSave={(form) => void saveProduct(form)} />}
    {categoryEditor && <CategoryDialog category={categoryEditor === 'new' ? undefined : categoryEditor} error={editorError} onClose={() => setCategoryEditor(null)} onSave={(form) => void saveCategory(form)} />}
    {paymentSale && <PaymentDialog sale={paymentSale} balance={balanceForSale(paymentSale, payments)} amount={paymentAmount} date={paymentDate} method={paymentMethodLater} saving={saving} error={paymentError} uncertain={paymentUncertain} onClose={() => setPaymentSale(null)} onAmount={setPaymentAmount} onDate={setPaymentDate} onMethod={setPaymentMethodLater} onSave={() => void recordPayment()} />}
    {voidSale && <VoidDialog sale={voidSale} reason={voidReason} saving={saving} error={editorError} onReason={setVoidReason} onClose={() => setVoidSale(null)} onSave={() => void voidCurrentSale()} />}
  </section>
}

/** Ícono y tono del producto según el nombre de su categoría (solo presentación). */
function productTone(categoryName: string): { tone: string; icon: IconName } {
  const name = categoryName.toLocaleLowerCase()
  if (/beb|agua|gaseos|cerve|jugo|vino/.test(name)) return { tone: 'bebidas', icon: 'bottle' }
  if (/cocin|comid|sand|minuta|pizza|empan/.test(name)) return { tone: 'cocina', icon: 'burger' }
  if (/kiosc|golos|snack|alfajor|dulce/.test(name)) return { tone: 'kiosco', icon: 'candy' }
  if (/tenis|pelota|grip|raque|cuerda|accesor/.test(name)) return { tone: 'tenis', icon: 'ball' }
  return { tone: 'general', icon: 'grip' }
}

function Ticket({ cart, saving, inSheet = false, onClear, onQuantity, onConfirm }: { cart: CartLine[]; saving: boolean; inSheet?: boolean; onClear: () => void; onQuantity: (productId: string, quantity: number) => void; onConfirm: (mode: CheckoutMode) => void }) {
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  if (cart.length === 0) {
    return <div className={`ticket ${inSheet ? 'ticket-sheet' : ''}`}>{!inSheet && <TicketHead count={0} />}<EmptyState icon="cart" title="Venta vacía" body="Tocá un producto para agregarlo." /></div>
  }
  return (
    <div className={`ticket ${inSheet ? 'ticket-sheet' : ''}`}>
      {!inSheet && <TicketHead count={count} onClear={onClear} disabled={saving} />}
      <ul className="ticket-lines">
        {cart.map((line) => (
          <li key={line.productId} className="ticket-line">
            <span className="ticket-line-name">{line.name}<small className="num">{formatArs(line.unitPriceCents)} c/u</small></span>
            <Stepper value={line.quantity} label={line.name} onChange={(quantity) => onQuantity(line.productId, quantity)} />
            <strong className="ticket-line-total num">{formatArs(line.quantity * line.unitPriceCents)}</strong>
          </li>
        ))}
      </ul>
      <div className="ticket-total"><span>Total</span><strong className="display num">{formatArs(cartTotalCents(cart))}</strong></div>
      <div className="ticket-actions">
        <Button variant="accent" size="lg" block icon="cash" onClick={() => onConfirm('paid')}>Confirmar venta</Button>
        <Button variant="secondary" block icon="note" onClick={() => onConfirm('pending')}>Anotar a cuenta</Button>
        {inSheet && <Button variant="ghost" block icon="trash" onClick={onClear} disabled={saving}>Vaciar venta</Button>}
      </div>
    </div>
  )
}

function TicketHead({ count, onClear, disabled }: { count: number; onClear?: () => void; disabled?: boolean }) {
  return (
    <header className="ticket-head">
      <div><p className="kicker">Venta actual</p><strong>{count ? plural(count, 'producto', 'productos') : 'Sin productos'}</strong></div>
      {onClear && <Button variant="ghost" size="sm" icon="trash" onClick={onClear} disabled={disabled}>Vaciar</Button>}
    </header>
  )
}

const saleDay = (value: string, timezone: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: timezone }).format(new Date(value))
const saleClock = (value: string, timezone: string) => new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(new Date(value))
const STATUS_TONE = { pending: 'clay', partial: 'warning', paid: 'success', voided: 'neutral' } as const

function PendingSales({ sales, people, payments, items, timezone, search, onSearch, onPay }: { sales: CanteenSale[]; people: Map<string, ClubPerson>; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; search: string; onSearch: (value: string) => void; onPay: (sale: CanteenSale) => void }) {
  const total = sales.reduce((sum, sale) => sum + balanceForSale(sale, payments), 0)
  return <section className="pos-pending" aria-label="Consumos pendientes">
    <div className="pos-pending-toolbar">
      <TextInput icon="search" type="search" placeholder="Buscar persona" aria-label="Buscar persona" value={search} onChange={(event) => onSearch(event.target.value)} />
      <p className="muted">{plural(sales.length, 'consumo', 'consumos')} · {formatArs(total)}</p>
    </div>
    {sales.length === 0 ? <EmptyState icon="checkCircle" title="Nadie debe consumos" body="No hay consumos pendientes para esta búsqueda." /> : (
      <ul className="account-list pos-sale-list">
        {sales.map((sale) => <SaleRow key={sale.id} sale={sale} person={sale.customer_person_id ? people.get(sale.customer_person_id) : undefined} payments={payments} items={items} timezone={timezone} action={<Button variant="secondary" size="sm" icon="check" onClick={() => onPay(sale)}>Registrar pago</Button>} />)}
      </ul>
    )}
  </section>
}
function SalesHistory({ sales, people, payments, items, timezone, canVoid, onPay, onVoid }: { sales: CanteenSale[]; people: Map<string, ClubPerson>; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; canVoid: boolean; onPay: (sale: CanteenSale) => void; onVoid: (sale: CanteenSale) => void }) {
  if (sales.length === 0) return <EmptyState icon="receipt" title="Todavía no hay ventas" body="Las ventas confirmadas se listan acá con su estado de pago." />
  return <section aria-label="Historial de ventas">
    <ul className="pos-sale-list pos-sale-list-card">
      {sales.map((sale) => <SaleRow key={sale.id} sale={sale} person={sale.customer_person_id ? people.get(sale.customer_person_id) : undefined} payments={payments} items={items} timezone={timezone} action={<>{sale.status === 'confirmed' && balanceForSale(sale, payments) > 0 && <Button variant="secondary" size="sm" icon="cash" onClick={() => onPay(sale)}>Cobrar</Button>}{canVoid && sale.status === 'confirmed' && paidForSale(sale.id, payments) === 0 && <Button variant="danger" size="sm" icon="x" onClick={() => onVoid(sale)}>Anular</Button>}</>} />)}
    </ul>
  </section>
}
function SaleRow({ sale, person, payments, items, timezone, action }: { sale: CanteenSale; person?: ClubPerson; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; action: ReactNode }) {
  const salePayments = payments.filter((payment) => payment.sale_id === sale.id); const saleItems = items.filter((item) => item.sale_id === sale.id); const status = saleStatus(sale, payments)
  return <li className={`pos-sale-row has-actions ${status === 'voided' ? 'is-voided' : ''}`}>
    <span className="sale-time num">{saleClock(sale.created_at, timezone)}<small>{saleDay(sale.created_at, timezone)}</small></span>
    <span className="sale-main">
      <strong>{person?.full_name ?? 'Venta sin cliente'}</strong>
      <span>{saleItems.map((item) => `${item.product_name_snapshot} ×${item.quantity}`).join(', ') || 'Ítems cargando…'}</span>
      {salePayments.length > 0 && <small>{salePayments.map((payment) => `${paymentLabels[payment.payment_method]} ${formatArs(payment.amount_cents)}`).join(' · ')}</small>}
    </span>
    <span className="sale-side">
      <strong className="num">{formatArs(sale.total_cents)}</strong>
      <Badge tone={STATUS_TONE[status]} icon={status === 'paid' ? 'check' : undefined}>{statusLabel(status)}</Badge>
      <small className="muted">Cobrado {formatArs(paidForSale(sale.id, payments))} · Pendiente {formatArs(balanceForSale(sale, payments))}</small>
    </span>
    <span className="sale-actions">{action}</span>
  </li>
}
function Catalog({ categories, products, onNewProduct, onEditProduct, onNewCategory, onEditCategory }: { categories: CanteenCategory[]; products: CanteenProduct[]; onNewProduct: () => void; onEditProduct: (product: CanteenProduct) => void; onNewCategory: () => void; onEditCategory: (category: CanteenCategory) => void }) {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]))
  return <div className="catalog-grid">
    <section className="card" aria-label="Productos del catálogo">
      <div className="catalog-head"><h3 className="section-title">Productos</h3><Button variant="accent" size="sm" icon="plus" onClick={onNewProduct}>Nuevo producto</Button></div>
      {products.length === 0 ? <EmptyState icon="bottle" title="Sin productos" body="Creá el primero para empezar a vender." /> : <ul className="pos-sale-list">{products.map((product) => <li className="catalog-row" key={product.id}><span className="sale-main"><strong>{product.name}</strong><span>{categoryName.get(product.category_id) ?? 'Sin categoría'}</span></span><Badge tone={product.active ? 'success' : 'neutral'}>{product.active ? 'Activo' : 'Inactivo'}</Badge><strong className="num">{formatArs(product.sale_price_cents)}</strong><Button variant="secondary" size="sm" icon="edit" onClick={() => onEditProduct(product)} aria-label={`Editar ${product.name}`}>Editar</Button></li>)}</ul>}
    </section>
    <section className="card" aria-label="Categorías del catálogo">
      <div className="catalog-head"><h3 className="section-title">Categorías</h3><Button variant="secondary" size="sm" icon="plus" onClick={onNewCategory}>Nueva categoría</Button></div>
      {categories.length === 0 ? <EmptyState icon="list" title="Sin categorías" body="Creá una categoría antes de cargar productos." /> : <ul className="pos-sale-list">{categories.map((category) => <li className="catalog-row" key={category.id}><span className="sale-main"><strong>{category.name}</strong></span><Badge tone={category.active ? 'success' : 'neutral'}>{category.active ? 'Activa' : 'Inactiva'}</Badge><Button variant="secondary" size="sm" icon="edit" onClick={() => onEditCategory(category)} aria-label={`Editar ${category.name}`}>Editar</Button></li>)}</ul>}
    </section>
  </div>
}
function CheckoutDialog(props: { cartTotal: number; mode: CheckoutMode; paymentMethod: PaymentMethod; selectedCustomer: ClubPerson | null; customerSearch: string; matchingPeople: ClubPerson[]; saving: boolean; error: string | null; uncertain: boolean; onClose: () => void; onModeChange: (mode: CheckoutMode) => void; onPaymentMethod: (method: PaymentMethod) => void; onSearch: (value: string) => void; onSelect: (person: ClubPerson) => void; onClear: () => void; onQuickCreate: () => void; onConfirm: () => void }) {
  return <Modal open onClose={props.onClose} busy={props.saving} size="sm" eyebrow="Venta actual" title="Confirmar venta"
    footer={<div className="form-actions"><Button variant="ghost" onClick={props.onClose} disabled={props.saving}>Volver</Button><Button variant="accent" size="lg" icon={props.uncertain ? 'refresh' : 'check'} loading={props.saving} disabled={props.mode === 'pending' && !props.selectedCustomer} onClick={props.onConfirm}>{props.saving ? 'Confirmando…' : props.uncertain ? 'Reintentar confirmación' : props.mode === 'paid' ? 'Cobrar y confirmar' : 'Confirmar pendiente'}</Button></div>}>
    <div className="checkout">
      <p className="ticket-total"><span>Total</span><strong className="display num">{formatArs(props.cartTotal)}</strong></p>
      <SegmentedTabs label="¿Cómo se registra?" stretch value={props.mode} onChange={props.onModeChange} items={[{ id: 'paid', label: 'Cobrar ahora', icon: 'cash' }, { id: 'pending', label: 'Dejar pendiente', icon: 'note' }]} />
      {props.mode === 'paid' ? (
        <fieldset className="form-block"><legend className="form-legend">Medio de pago</legend><MethodPicker value={props.paymentMethod} onChange={props.onPaymentMethod} /></fieldset>
      ) : props.selectedCustomer ? (
        <div className="person-pill"><Avatar name={props.selectedCustomer.full_name} size="sm" /><span className="person-pill-name">{props.selectedCustomer.full_name}</span><button type="button" className="link-btn" onClick={props.onClear}>Cambiar</button></div>
      ) : (
        <div className="picker">
          <Field label="Buscar persona" hint="Un consumo pendiente necesita una ficha del club.">{(id, describedBy) => <TextInput id={id} icon="search" value={props.customerSearch} aria-describedby={describedBy} placeholder="Nombre de la persona" autoComplete="off" onChange={(event) => props.onSearch(event.target.value)} data-autofocus />}</Field>
          <ul className="picker-list">
            {props.matchingPeople.map((person) => <li key={person.id}><button type="button" className="picker-row" onClick={() => props.onSelect(person)}><Avatar name={person.full_name} size="sm" /><span>{person.full_name}</span>{person.phone && <small className="muted">{person.phone}</small>}</button></li>)}
            {props.customerSearch.trim() && <li><button type="button" className="picker-row picker-create" onClick={props.onQuickCreate}><span className="picker-create-icon"><Icon name="userPlus" size={18} /></span><span>Dar de alta a “{props.customerSearch.trim()}”<small className="picker-reason">Alta rápida, sin cuenta ni membresía</small></span></button></li>}
          </ul>
        </div>
      )}
      {props.error && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{props.error}</div></div>}
    </div>
  </Modal>
}
function ProductDialog({ product, categories, error, onClose, onSave }: { product?: CanteenProduct; categories: CanteenCategory[]; error: string | null; onClose: () => void; onSave: (form: ProductForm) => void }) {
  const [form, setForm] = useState<ProductForm>({ name: product?.name ?? '', categoryId: product?.category_id ?? categories.find((category) => category.active)?.id ?? '', price: product ? String(product.sale_price_cents / 100).replace('.', ',') : '', active: product?.active ?? true })
  return <Modal open onClose={onClose} size="sm" eyebrow="Catálogo" title={product ? 'Editar producto' : 'Nuevo producto'}
    footer={<div className="form-actions"><Button variant="ghost" onClick={onClose}>Volver</Button><Button type="submit" form="product-form" variant="accent" size="lg" icon="check">Guardar</Button></div>}>
    <form id="product-form" className="res-form" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(form) }}>
      <Field label="Nombre">{(id) => <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-autofocus />}</Field>
      <Field label="Categoría">{(id) => <SelectInput id={id} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inactiva)'}</option>)}</SelectInput>}</Field>
      <Field label="Precio de venta" hint="El precio queda registrado en cada venta: cambiarlo no altera ventas anteriores.">{(id, describedBy) => <MoneyInput id={id} aria-describedby={describedBy} value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="3000" />}</Field>
      {product && <Switch checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Producto activo" description="Los productos inactivos no aparecen para vender." />}
      {error && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{error}</div></div>}
    </form>
  </Modal>
}
function CategoryDialog({ category, error, onClose, onSave }: { category?: CanteenCategory; error: string | null; onClose: () => void; onSave: (form: CategoryForm) => void }) {
  const [form, setForm] = useState<CategoryForm>({ name: category?.name ?? '', active: category?.active ?? true })
  return <Modal open onClose={onClose} size="sm" eyebrow="Catálogo" title={category ? 'Editar categoría' : 'Nueva categoría'}
    footer={<div className="form-actions"><Button variant="ghost" onClick={onClose}>Volver</Button><Button type="submit" form="category-form" variant="accent" size="lg" icon="check">Guardar</Button></div>}>
    <form id="category-form" className="res-form" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(form) }}>
      <Field label="Nombre">{(id) => <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-autofocus />}</Field>
      {category && <Switch checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Categoría activa" />}
      {error && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{error}</div></div>}
    </form>
  </Modal>
}
function PaymentDialog({ sale, balance, amount, date, method, saving, error, uncertain, onClose, onAmount, onDate, onMethod, onSave }: { sale: CanteenSale; balance: number; amount: string; date: string; method: PaymentMethod; saving: boolean; error: string | null; uncertain: boolean; onClose: () => void; onAmount: (value: string) => void; onDate: (value: string) => void; onMethod: (value: PaymentMethod) => void; onSave: () => void }) {
  return <Modal open onClose={onClose} busy={saving} size="sm" eyebrow="Consumo pendiente" title="Registrar pago de consumo"
    footer={<div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={saving}>Volver</Button><Button variant="accent" size="lg" icon={uncertain ? 'refresh' : 'check'} loading={saving} onClick={onSave}>{saving ? 'Guardando…' : uncertain ? 'Reintentar pago' : 'Registrar pago'}</Button></div>}>
    <div className="res-form">
      <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Saldo disponible: <strong>{formatArs(balance)}</strong> sobre una venta de {formatArs(sale.total_cents)}. Podés registrar un pago parcial.</span></p>
      <Field label="Importe">{(id) => <MoneyInput id={id} value={amount} onChange={(event) => onAmount(event.target.value)} data-autofocus />}</Field>
      <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} onChange={(event) => onDate(event.target.value)} />}</Field>
      <fieldset className="form-block"><legend className="form-legend">Medio de pago</legend><MethodPicker variant="chips" value={method} onChange={onMethod} /></fieldset>
      {error && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{error}</div></div>}
    </div>
  </Modal>
}
function VoidDialog({ sale, reason, saving, error, onClose, onReason, onSave }: { sale: CanteenSale; reason: string; saving: boolean; error: string | null; onClose: () => void; onReason: (value: string) => void; onSave: () => void }) {
  return <Modal open onClose={onClose} busy={saving} size="sm" eyebrow="Historial" title="Anular venta"
    footer={<div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={saving}>Volver</Button><Button variant="danger" size="lg" icon="x" loading={saving} onClick={onSave}>Anular venta</Button></div>}>
    <div className="res-form">
      <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Se anulará la venta de {formatArs(sale.total_cents)}. Esta acción deja auditoría y solo está permitida sin pagos.</span></p>
      <Field label="Motivo">{(id) => <TextArea id={id} value={reason} onChange={(event) => onReason(event.target.value)} rows={3} data-autofocus />}</Field>
      {error && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{error}</div></div>}
    </div>
  </Modal>
}
