import { createContext, useContext, type Dispatch } from 'react'
import {
  BOOKING_RULES, buildDues, buildSales, buildSeed, balanceCents, CLUB, COURTS, FEE_SETTINGS, INVITATIONS, PEOPLE, TODAY,
  type BookingRules, type Club, type Court, type Due, type DuePayment, type FeeSettings, type Invitation, type Occupation,
  type PaymentMethod, type Person, type Sale, type Tournament,
} from '../data/mock'

export type CartLine = { productId: string; qty: number }

/**
 * Pedido de navegación con contexto: abrir una ficha, una clase o un formulario al llegar a una sección.
 * La pantalla destino lo consume y lo limpia.
 */
export type Intent =
  | { kind: 'newPlayer' }
  | { kind: 'player'; id: string }
  | { kind: 'newLesson' }
  | { kind: 'lesson'; id: string }
  | { kind: 'match'; tournamentId: string; categoryId: string; matchId: string }
  | { kind: 'invite'; personId?: string }
  | { kind: 'pay'; personId?: string }

export type State = {
  club: Club
  courts: Court[]
  people: Person[]
  occupations: Occupation[]
  sales: Sale[]
  cart: CartLine[]
  cartPersonId: string | null
  contact: { phone: string; email: string }
  fees: FeeSettings
  dues: Due[]
  duePayments: DuePayment[]
  tournaments: Tournament[]
  invitations: Invitation[]
  bookingRules: BookingRules
  intent: Intent | null
}

export type Action =
  | { type: 'occ/add'; occupation: Occupation }
  | { type: 'occ/addMany'; occupations: Occupation[] }
  | { type: 'occ/update'; occupation: Occupation }
  | { type: 'occ/cancel'; id: string }
  | { type: 'cart/add'; productId: string }
  | { type: 'cart/set'; productId: string; qty: number }
  | { type: 'cart/clear' }
  | { type: 'cart/person'; personId: string | null }
  | { type: 'sale/add'; sale: Sale }
  | { type: 'sale/pay'; saleId: string; amountCents: number; method: PaymentMethod }
  | { type: 'sale/payAll'; personId: string; method: PaymentMethod }
  | { type: 'sale/void'; saleId: string; reason: string }
  | { type: 'contact/save'; phone: string; email: string }
  | { type: 'person/add'; person: Person }
  | { type: 'person/update'; person: Person }
  | { type: 'court/update'; court: Court }
  | { type: 'court/move'; id: string; delta: -1 | 1 }
  | { type: 'fees/save'; fees: FeeSettings }
  | { type: 'dues/add'; dues: Due[] }
  | { type: 'duePay/add'; payment: DuePayment }
  | { type: 'duePay/void'; id: string; reason: string }
  | { type: 'tournament/save'; tournament: Tournament }
  | { type: 'invite/add'; invitation: Invitation }
  | { type: 'invite/revoke'; id: string }
  | { type: 'invite/redeem'; id: string }
  | { type: 'rules/save'; rules: BookingRules }
  | { type: 'club/save'; club: Club }
  | { type: 'intent/set'; intent: Intent }
  | { type: 'intent/clear' }
  | { type: 'reset' }

export function initialState(): State {
  const seed = buildSeed()
  const { dues, payments } = buildDues()
  return {
    club: CLUB,
    courts: COURTS,
    people: PEOPLE,
    occupations: seed.occupations,
    sales: buildSales(),
    cart: [],
    cartPersonId: null,
    contact: { phone: '3496 41-2290', email: 'martina.gomez@correo.test' },
    fees: FEE_SETTINGS,
    dues,
    duePayments: payments,
    tournaments: seed.tournaments,
    invitations: INVITATIONS,
    bookingRules: BOOKING_RULES,
    intent: null,
  }
}

const replace = <T extends { id: string }>(list: T[], item: T) => list.map((current) => (current.id === item.id ? item : current))

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'occ/add':
      return { ...state, occupations: [...state.occupations, action.occupation] }
    case 'occ/addMany':
      return { ...state, occupations: [...state.occupations, ...action.occupations] }
    case 'occ/update':
      return { ...state, occupations: replace(state.occupations, action.occupation) }
    case 'occ/cancel':
      // La app real hace cancelación lógica (conserva historial); el prototipo solo la quita de la grilla.
      return { ...state, occupations: state.occupations.filter((item) => item.id !== action.id) }
    case 'cart/add': {
      const existing = state.cart.find((item) => item.productId === action.productId)
      const cart = existing
        ? state.cart.map((item) => (item.productId === action.productId ? { ...item, qty: item.qty + 1 } : item))
        : [...state.cart, { productId: action.productId, qty: 1 }]
      return { ...state, cart }
    }
    case 'cart/set':
      return {
        ...state,
        cart: action.qty <= 0
          ? state.cart.filter((item) => item.productId !== action.productId)
          : state.cart.map((item) => (item.productId === action.productId ? { ...item, qty: action.qty } : item)),
      }
    case 'cart/clear':
      return { ...state, cart: [], cartPersonId: null }
    case 'cart/person':
      return { ...state, cartPersonId: action.personId }
    case 'sale/add':
      return { ...state, sales: [action.sale, ...state.sales] }
    case 'sale/pay':
      return {
        ...state,
        sales: state.sales.map((item) => (item.id === action.saleId
          ? { ...item, payments: [...item.payments, { amountCents: Math.min(action.amountCents, balanceCents(item)), method: action.method, date: TODAY }] }
          : item)),
      }
    case 'sale/payAll':
      // Un pago por venta, igual que el dominio real: nunca un saldo global mutable.
      return {
        ...state,
        sales: state.sales.map((item) => (item.personId === action.personId && balanceCents(item) > 0
          ? { ...item, payments: [...item.payments, { amountCents: balanceCents(item), method: action.method, date: TODAY }] }
          : item)),
      }
    case 'sale/void':
      return { ...state, sales: state.sales.map((item) => (item.id === action.saleId ? { ...item, voided: { reason: action.reason } } : item)) }
    case 'contact/save':
      return { ...state, contact: { phone: action.phone, email: action.email } }
    case 'person/add':
      return { ...state, people: [...state.people, action.person] }
    case 'person/update':
      return { ...state, people: replace(state.people, action.person) }
    case 'court/update':
      return { ...state, courts: replace(state.courts, action.court) }
    case 'court/move': {
      const ordered = [...state.courts].sort((a, b) => a.order - b.order)
      const index = ordered.findIndex((court) => court.id === action.id)
      const target = index + action.delta
      if (index < 0 || target < 0 || target >= ordered.length) return state
      ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
      return { ...state, courts: ordered.map((court, position) => ({ ...court, order: position + 1 })) }
    }
    case 'fees/save':
      return { ...state, fees: action.fees }
    case 'dues/add': {
      // Emisión idempotente: nunca dos cuotas del mismo período para la misma persona.
      const fresh = action.dues.filter((due) => !state.dues.some((other) => other.personId === due.personId && other.period === due.period))
      return { ...state, dues: [...state.dues, ...fresh] }
    }
    case 'duePay/add':
      return { ...state, duePayments: [...state.duePayments, action.payment] }
    case 'duePay/void':
      return { ...state, duePayments: state.duePayments.map((item) => (item.id === action.id ? { ...item, voided: { reason: action.reason, date: TODAY } } : item)) }
    case 'tournament/save':
      return { ...state, tournaments: state.tournaments.some((item) => item.id === action.tournament.id) ? replace(state.tournaments, action.tournament) : [action.tournament, ...state.tournaments] }
    case 'invite/add':
      return { ...state, invitations: [action.invitation, ...state.invitations] }
    case 'invite/revoke':
      return { ...state, invitations: state.invitations.map((item) => (item.id === action.id ? { ...item, revokedOn: TODAY } : item)) }
    case 'invite/redeem': {
      const invitation = state.invitations.find((item) => item.id === action.id)
      if (!invitation) return state
      return {
        ...state,
        invitations: state.invitations.map((item) => (item.id === action.id ? { ...item, redeemedOn: TODAY } : item)),
        people: state.people.map((person) => (person.id === invitation.personId ? { ...person, hasAccount: true } : person)),
      }
    }
    case 'rules/save':
      return { ...state, bookingRules: action.rules }
    case 'club/save':
      return { ...state, club: action.club }
    case 'intent/set':
      return { ...state, intent: action.intent }
    case 'intent/clear':
      return state.intent ? { ...state, intent: null } : state
    case 'reset':
      return initialState()
  }
}

export const StoreContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null)

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore fuera de StoreProvider')
  return value
}
