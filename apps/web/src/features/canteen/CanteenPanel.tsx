import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanteenCategory, CanteenProduct, CanteenSale, CanteenSaleItem, CanteenSalePayment, Club, ClubPerson, PaymentMethod } from '../../types/domain'
import { formatArs, parseArsToCents, todayInClubTimezone } from '../fees/feeUtils'
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
const paymentLabels: Record<PaymentMethod, string> = { cash: 'Efectivo', bank_transfer: 'Transferencia', mercado_pago: 'Mercado Pago', other: 'Otro' }

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
  return <section className="person-canteen"><h3>Consumos de cantina</h3>{loading ? <p className="field-help">Cargando consumos…</p> : <>{sales.length === 0 ? <p className="field-help">No hay consumos de cantina asociados.</p> : <><p className="account-total"><strong>Saldo pendiente de cantina: {formatArs(pending)}</strong></p><ul>{sales.map((sale) => <li key={sale.id}>{dateTime(sale.created_at, club.timezone)} · {formatArs(sale.total_cents)} · <span>{statusLabel(saleStatus(sale, payments))}</span>{paidForSale(sale.id, payments) > 0 && <small> Cobrado: {formatArs(paidForSale(sale.id, payments))}</small>}</li>)}</ul></>}</>}</section>
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
  const [categoryFilter, setCategoryFilter] = useState('all')
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

  const visibleProducts = useMemo(() => products.filter((product) => product.active && (categoryFilter === 'all' || product.category_id === categoryFilter) && product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())), [products, categoryFilter, search])
  const selectedCustomer = people.find((person) => person.id === customerId) ?? null
  const matchingPeople = people.filter((person) => person.active && person.full_name.toLocaleLowerCase().includes(customerSearch.toLocaleLowerCase().trim())).slice(0, 8)
  const personById = new Map(people.map((person) => [person.id, person]))
  const pendingSales = sales.filter((sale) => sale.status === 'confirmed' && balanceForSale(sale, payments) > 0 && (pendingSearch.trim() === '' || (sale.customer_person_id ? personById.get(sale.customer_person_id)?.full_name.toLocaleLowerCase().includes(pendingSearch.toLocaleLowerCase().trim()) : false)))
  const today = todayInClubTimezone(club.timezone)
  const stats = useMemo(() => ({ sold: sales.filter((sale) => sale.status === 'confirmed' && dateInTimezone(sale.created_at, club.timezone) === today).reduce((sum, sale) => sum + sale.total_cents, 0), collected: payments.filter((payment) => payment.payment_date === today).reduce((sum, payment) => sum + payment.amount_cents, 0), pending: sales.reduce((sum, sale) => sum + balanceForSale(sale, payments), 0) }), [sales, payments, today, club.timezone])

  const addProduct = (product: CanteenProduct) => setCart((current) => addToCart(current, { productId: product.id, name: product.name, unitPriceCents: product.sale_price_cents }))
  const openCheckout = () => { if (cart.length > 0) { setCheckoutMode('paid'); setCustomerId(null); setCustomerSearch(''); setCheckoutOpen(true) } }
  const createQuickPerson = async () => {
    const name = customerSearch.trim(); if (!name) return
    const { data, error } = await client.from('club_people').insert({ club_id: club.id, full_name: name, active: true }).select(personFields).single()
    if (error) return setFeedback('No pudimos crear la persona. Intentá nuevamente.')
    const person = data as ClubPerson; setPeople((current) => [...current, person].sort((a, b) => a.full_name.localeCompare(b.full_name))); setCustomerId(person.id); setCustomerSearch('')
  }
  const confirmSale = async () => {
    if (cart.length === 0 || (checkoutMode === 'pending' && !customerId)) return
    setSaving(true); setFeedback(null)
    const { error } = await client.rpc('create_canteen_sale', { p_club_id: club.id, p_items: cart.map((line) => ({ product_id: line.productId, quantity: line.quantity })), p_customer_person_id: checkoutMode === 'pending' ? customerId : null, p_payment_method: checkoutMode === 'paid' ? paymentMethod : null, p_client_request_id: crypto.randomUUID() })
    setSaving(false)
    if (error) return setFeedback(errorText(error, 'No pudimos confirmar la venta.'))
    setCart([]); setCheckoutOpen(false); setFeedback('Venta registrada correctamente.'); await load()
  }
  const saveProduct = async (form: ProductForm) => {
    const price = parseArsToCents(form.price); if (!form.name.trim() || !form.categoryId || price === null) return setFeedback('Completá nombre, categoría y un precio válido mayor a cero.')
    const payload = { club_id: club.id, name: form.name.trim(), category_id: form.categoryId, sale_price_cents: price, active: form.active }
    const result = productEditor === 'new' ? await client.from('canteen_products').insert(payload) : await client.from('canteen_products').update(payload).eq('id', productEditor?.id ?? '').eq('club_id', club.id)
    if (result.error) return setFeedback(errorText(result.error, 'No pudimos guardar el producto.'))
    setProductEditor(null); await load()
  }
  const saveCategory = async (form: CategoryForm) => {
    if (!form.name.trim()) return setFeedback('Indicá un nombre para la categoría.')
    const payload = { club_id: club.id, name: form.name.trim(), active: form.active }
    const result = categoryEditor === 'new' ? await client.from('canteen_categories').insert(payload) : await client.from('canteen_categories').update(payload).eq('id', categoryEditor?.id ?? '').eq('club_id', club.id)
    if (result.error) return setFeedback(errorText(result.error, 'No pudimos guardar la categoría.'))
    setCategoryEditor(null); await load()
  }
  const recordPayment = async () => {
    if (!paymentSale) return; const amount = parseArsToCents(paymentAmount); if (amount === null) return setFeedback('Indicá un importe válido mayor a cero.')
    setSaving(true); const { error } = await client.rpc('record_canteen_sale_payment', { p_club_id: club.id, p_sale_id: paymentSale.id, p_amount_cents: amount, p_payment_date: paymentDate, p_payment_method: paymentMethodLater, p_reference: null, p_notes: null }); setSaving(false)
    if (error) return setFeedback(errorText(error, 'No pudimos registrar el pago.'))
    setPaymentSale(null); setFeedback('Pago registrado.'); await load()
  }
  const voidCurrentSale = async () => {
    if (!voidSale || !voidReason.trim()) return setFeedback('Indicá el motivo de la anulación.')
    setSaving(true); const { error } = await client.rpc('void_canteen_sale', { p_sale_id: voidSale.id, p_reason: voidReason }); setSaving(false)
    if (error) return setFeedback(errorText(error, 'No pudimos anular la venta.'))
    setVoidSale(null); setVoidReason(''); setFeedback('Venta anulada.'); await load()
  }

  return <section className="canteen-section"><div className="section-heading"><div><p className="eyebrow">Cantina</p><h2>Ventas rápidas y consumos</h2></div><p>Las ventas pagadas no requieren cliente. Los consumos pendientes siempre se asocian a una persona.</p></div>
    {feedback && <p className="form-error" role="alert">{feedback}</p>}
    {canManageCatalog && <section className="canteen-stats" aria-label="Estadísticas de cantina"><div><span>Ventas de hoy</span><strong>{formatArs(stats.sold)}</strong></div><div><span>Cobrado hoy</span><strong>{formatArs(stats.collected)}</strong></div><div><span>Saldo pendiente</span><strong>{formatArs(stats.pending)}</strong></div></section>}
    <nav className="school-nav" aria-label="Secciones de cantina"><button className={view === 'sell' ? 'nav-button active' : 'nav-button'} onClick={() => setView('sell')} type="button">Vender</button><button className={view === 'pending' ? 'nav-button active' : 'nav-button'} onClick={() => setView('pending')} type="button">Consumos pendientes</button><button className={view === 'history' ? 'nav-button active' : 'nav-button'} onClick={() => setView('history')} type="button">Historial</button>{canManageCatalog && <button className={view === 'catalog' ? 'nav-button active' : 'nav-button'} onClick={() => setView('catalog')} type="button">Productos</button>}</nav>
    {loading ? <p className="screen-message" role="status">Cargando cantina…</p> : <>
      {view === 'sell' && <div className="canteen-sell"><section className="canteen-products"><div className="canteen-filters"><label>Buscar producto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Gaseosa, pelota…" /></label><label>Categoría<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div><div className="product-grid">{visibleProducts.map((product) => <button key={product.id} type="button" className="product-button" onClick={() => addProduct(product)}><strong>{product.name}</strong><span>{formatArs(product.sale_price_cents)}</span></button>)}{visibleProducts.length === 0 && <p className="field-help">No hay productos activos para este filtro.</p>}</div></section><aside className="cart-card"><h3>Venta actual</h3>{cart.length === 0 ? <p className="field-help">Tocá un producto para agregarlo.</p> : <><ul className="cart-lines">{cart.map((line) => <li key={line.productId}><div><strong>{line.name}</strong><span>{formatArs(line.unitPriceCents)} c/u</span></div><div className="quantity-control"><button type="button" aria-label={`Quitar una unidad de ${line.name}`} onClick={() => setCart((current) => changeCartQuantity(current, line.productId, line.quantity - 1))}>−</button><strong>{line.quantity}</strong><button type="button" aria-label={`Agregar una unidad de ${line.name}`} onClick={() => setCart((current) => changeCartQuantity(current, line.productId, line.quantity + 1))}>+</button></div><strong>{formatArs(line.quantity * line.unitPriceCents)}</strong></li>)}</ul><div className="cart-total"><span>Total</span><strong>{formatArs(cartTotalCents(cart))}</strong></div><div className="cart-actions"><button className="secondary-button" type="button" onClick={() => setCart([])}>Vaciar</button><button type="button" onClick={openCheckout}>Confirmar venta</button></div></>}</aside></div>}
      {view === 'pending' && <PendingSales sales={pendingSales} people={personById} payments={payments} items={items} timezone={club.timezone} search={pendingSearch} onSearch={setPendingSearch} onPay={(sale) => { setPaymentSale(sale); setPaymentAmount(String(balanceForSale(sale, payments) / 100).replace('.', ',')); setPaymentDate(today) }} />}
      {view === 'history' && <SalesHistory sales={sales} people={personById} items={items} payments={payments} timezone={club.timezone} canVoid={canManageCatalog} onPay={(sale) => { setPaymentSale(sale); setPaymentAmount(String(balanceForSale(sale, payments) / 100).replace('.', ',')); setPaymentDate(today) }} onVoid={(sale) => setVoidSale(sale)} />}
      {view === 'catalog' && canManageCatalog && <Catalog categories={categories} products={products} onNewProduct={() => setProductEditor('new')} onEditProduct={setProductEditor} onNewCategory={() => setCategoryEditor('new')} onEditCategory={setCategoryEditor} />}
    </>}
    {checkoutOpen && <CheckoutDialog cartTotal={cartTotalCents(cart)} mode={checkoutMode} paymentMethod={paymentMethod} selectedCustomer={selectedCustomer} customerSearch={customerSearch} matchingPeople={matchingPeople} saving={saving} onClose={() => setCheckoutOpen(false)} onModeChange={setCheckoutMode} onPaymentMethod={setPaymentMethod} onSearch={setCustomerSearch} onSelect={(person) => { setCustomerId(person.id); setCustomerSearch('') }} onClear={() => setCustomerId(null)} onQuickCreate={() => void createQuickPerson()} onConfirm={() => void confirmSale()} />}
    {productEditor && <ProductDialog product={productEditor === 'new' ? undefined : productEditor} categories={categories} onClose={() => setProductEditor(null)} onSave={(form) => void saveProduct(form)} />}
    {categoryEditor && <CategoryDialog category={categoryEditor === 'new' ? undefined : categoryEditor} onClose={() => setCategoryEditor(null)} onSave={(form) => void saveCategory(form)} />}
    {paymentSale && <PaymentDialog sale={paymentSale} balance={balanceForSale(paymentSale, payments)} amount={paymentAmount} date={paymentDate} method={paymentMethodLater} saving={saving} onClose={() => setPaymentSale(null)} onAmount={setPaymentAmount} onDate={setPaymentDate} onMethod={setPaymentMethodLater} onSave={() => void recordPayment()} />}
    {voidSale && <VoidDialog sale={voidSale} reason={voidReason} saving={saving} onReason={setVoidReason} onClose={() => setVoidSale(null)} onSave={() => void voidCurrentSale()} />}
  </section>
}

function PendingSales({ sales, people, payments, items, timezone, search, onSearch, onPay }: { sales: CanteenSale[]; people: Map<string, ClubPerson>; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; search: string; onSearch: (value: string) => void; onPay: (sale: CanteenSale) => void }) {
  return <section className="sale-list"><div className="modal-heading"><h3>Personas con consumos pendientes</h3><label className="pending-search">Buscar persona<input value={search} onChange={(event) => onSearch(event.target.value)} /></label></div>{sales.length === 0 ? <p className="field-help">No hay consumos pendientes para esta búsqueda.</p> : sales.map((sale) => <SaleRow key={sale.id} sale={sale} person={sale.customer_person_id ? people.get(sale.customer_person_id) : undefined} payments={payments} items={items} timezone={timezone} action={<button type="button" onClick={() => onPay(sale)}>Registrar pago</button>} />)}</section>
}
function SalesHistory({ sales, people, payments, items, timezone, canVoid, onPay, onVoid }: { sales: CanteenSale[]; people: Map<string, ClubPerson>; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; canVoid: boolean; onPay: (sale: CanteenSale) => void; onVoid: (sale: CanteenSale) => void }) {
  return <section className="sale-list"><h3>Historial de ventas</h3>{sales.length === 0 ? <p className="field-help">Todavía no hay ventas registradas.</p> : sales.map((sale) => <SaleRow key={sale.id} sale={sale} person={sale.customer_person_id ? people.get(sale.customer_person_id) : undefined} payments={payments} items={items} timezone={timezone} action={<>{sale.status === 'confirmed' && balanceForSale(sale, payments) > 0 && <button type="button" onClick={() => onPay(sale)}>Cobrar</button>}{canVoid && sale.status === 'confirmed' && paidForSale(sale.id, payments) === 0 && <button className="danger-button" type="button" onClick={() => onVoid(sale)}>Anular</button>}</>} />)}</section>
}
function SaleRow({ sale, person, payments, items, timezone, action }: { sale: CanteenSale; person?: ClubPerson; payments: CanteenSalePayment[]; items: CanteenSaleItem[]; timezone: string; action: ReactNode }) {
  const salePayments = payments.filter((payment) => payment.sale_id === sale.id); const saleItems = items.filter((item) => item.sale_id === sale.id); const status = saleStatus(sale, payments)
  return <article className="sale-row"><div><strong>{person?.full_name ?? 'Venta sin cliente'}</strong><span>{dateTime(sale.created_at, timezone)} · {saleItems.map((item) => `${item.product_name_snapshot} ×${item.quantity}`).join(', ') || 'Ítems cargando…'}</span>{salePayments.length > 0 && <small>{salePayments.map((payment) => `${paymentLabels[payment.payment_method]} ${formatArs(payment.amount_cents)}`).join(' · ')}</small>}</div><div className="sale-amounts"><span className={`sale-status ${status}`}>{statusLabel(status)}</span><strong>{formatArs(sale.total_cents)}</strong><small>Cobrado {formatArs(paidForSale(sale.id, payments))} · Pendiente {formatArs(balanceForSale(sale, payments))}</small></div><div className="due-actions">{action}</div></article>
}
function Catalog({ categories, products, onNewProduct, onEditProduct, onNewCategory, onEditCategory }: { categories: CanteenCategory[]; products: CanteenProduct[]; onNewProduct: () => void; onEditProduct: (product: CanteenProduct) => void; onNewCategory: () => void; onEditCategory: (category: CanteenCategory) => void }) {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]))
  return <div className="catalog-layout"><section className="sale-list"><div className="modal-heading"><h3>Productos</h3><button type="button" onClick={onNewProduct}>Nuevo producto</button></div>{products.map((product) => <article className="sale-row" key={product.id}><div><strong>{product.name}</strong><span>{categoryName.get(product.category_id) ?? 'Sin categoría'} · {product.active ? 'Activo' : 'Inactivo'}</span></div><strong>{formatArs(product.sale_price_cents)}</strong><button className="secondary-button" type="button" onClick={() => onEditProduct(product)}>Editar</button></article>)}</section><section className="sale-list"><div className="modal-heading"><h3>Categorías</h3><button type="button" onClick={onNewCategory}>Nueva categoría</button></div>{categories.map((category) => <article className="sale-row" key={category.id}><div><strong>{category.name}</strong><span>{category.active ? 'Activa' : 'Inactiva'}</span></div><button className="secondary-button" type="button" onClick={() => onEditCategory(category)}>Editar</button></article>)}</section></div>
}
function CheckoutDialog(props: { cartTotal: number; mode: CheckoutMode; paymentMethod: PaymentMethod; selectedCustomer: ClubPerson | null; customerSearch: string; matchingPeople: ClubPerson[]; saving: boolean; onClose: () => void; onModeChange: (mode: CheckoutMode) => void; onPaymentMethod: (method: PaymentMethod) => void; onSearch: (value: string) => void; onSelect: (person: ClubPerson) => void; onClear: () => void; onQuickCreate: () => void; onConfirm: () => void }) {
  return <Modal title="Confirmar venta" onClose={props.onClose}><p className="cart-total"><span>Total</span><strong>{formatArs(props.cartTotal)}</strong></p><fieldset className="recurrence-fieldset"><legend>¿Cómo se registra?</legend><label><input type="radio" checked={props.mode === 'paid'} onChange={() => props.onModeChange('paid')} /> Cobrar ahora</label><label><input type="radio" checked={props.mode === 'pending'} onChange={() => props.onModeChange('pending')} /> Dejar pendiente</label></fieldset>{props.mode === 'paid' ? <label>Medio de pago<select value={props.paymentMethod} onChange={(event) => props.onPaymentMethod(event.target.value as PaymentMethod)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <><label>Buscar persona<input autoFocus value={props.customerSearch} onChange={(event) => props.onSearch(event.target.value)} placeholder="Nombre de la persona" /></label>{props.selectedCustomer ? <div className="selected-person"><span>{props.selectedCustomer.full_name}</span><button className="secondary-button" type="button" onClick={props.onClear}>Cambiar</button></div> : <><div className="player-matches">{props.matchingPeople.map((person) => <button key={person.id} type="button" onClick={() => props.onSelect(person)}>{person.full_name}{person.phone && <span>{person.phone}</span>}</button>)}</div>{props.customerSearch.trim() && <button className="secondary-button" type="button" onClick={props.onQuickCreate}>Dar de alta a “{props.customerSearch.trim()}”</button>}</>}</>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={props.onClose} disabled={props.saving}>Volver</button><button type="button" onClick={props.onConfirm} disabled={props.saving || (props.mode === 'pending' && !props.selectedCustomer)}>{props.saving ? 'Confirmando…' : props.mode === 'paid' ? 'Cobrar y confirmar' : 'Confirmar pendiente'}</button></div></Modal>
}
function ProductDialog({ product, categories, onClose, onSave }: { product?: CanteenProduct; categories: CanteenCategory[]; onClose: () => void; onSave: (form: ProductForm) => void }) {
  const [form, setForm] = useState<ProductForm>({ name: product?.name ?? '', categoryId: product?.category_id ?? categories.find((category) => category.active)?.id ?? '', price: product ? String(product.sale_price_cents / 100).replace('.', ',') : '', active: product?.active ?? true })
  return <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}><form className="reservation-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(form) }}><label>Nombre<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Categoría<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inactiva)'}</option>)}</select></label><label>Precio de venta<input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="3000" /></label>{product && <label className="toggle-field"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Producto activo</label>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Volver</button><button type="submit">Guardar</button></div></form></Modal>
}
function CategoryDialog({ category, onClose, onSave }: { category?: CanteenCategory; onClose: () => void; onSave: (form: CategoryForm) => void }) {
  const [form, setForm] = useState<CategoryForm>({ name: category?.name ?? '', active: category?.active ?? true })
  return <Modal title={category ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}><form className="reservation-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(form) }}><label>Nombre<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>{category && <label className="toggle-field"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Categoría activa</label>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Volver</button><button type="submit">Guardar</button></div></form></Modal>
}
function PaymentDialog({ sale, balance, amount, date, method, saving, onClose, onAmount, onDate, onMethod, onSave }: { sale: CanteenSale; balance: number; amount: string; date: string; method: PaymentMethod; saving: boolean; onClose: () => void; onAmount: (value: string) => void; onDate: (value: string) => void; onMethod: (value: PaymentMethod) => void; onSave: () => void }) {
  return <Modal title="Registrar pago de consumo" onClose={onClose}><p className="field-help">Saldo disponible: <strong>{formatArs(balance)}</strong> sobre una venta de {formatArs(sale.total_cents)}.</p><label>Importe<input autoFocus inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} /></label><label>Fecha<input type="date" value={date} onChange={(event) => onDate(event.target.value)} /></label><label>Medio de pago<select value={method} onChange={(event) => onMethod(event.target.value as PaymentMethod)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Volver</button><button type="button" disabled={saving} onClick={onSave}>{saving ? 'Guardando…' : 'Registrar pago'}</button></div></Modal>
}
function VoidDialog({ sale, reason, saving, onClose, onReason, onSave }: { sale: CanteenSale; reason: string; saving: boolean; onClose: () => void; onReason: (value: string) => void; onSave: () => void }) { return <Modal title="Anular venta" onClose={onClose}><p className="field-help">Se anulará la venta de {formatArs(sale.total_cents)}. Esta acción deja auditoría y solo está permitida sin pagos.</p><label>Motivo<textarea autoFocus value={reason} onChange={(event) => onReason(event.target.value)} rows={3} /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Volver</button><button className="danger-button" type="button" disabled={saving} onClick={onSave}>Anular venta</button></div></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div><div className="reservation-form">{children}</div></section></div> }
