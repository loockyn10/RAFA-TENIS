export type ClubRole = 'owner' | 'admin' | 'staff'

export type Club = {
  id: string
  name: string
  timezone: string
}

export type ClubMembership = {
  clubId: string
  role: ClubRole
}

export type Court = {
  id: string
  club_id: string
  name: string
  surface: string
  active: boolean
  display_order: number
}

export type OccupationType = 'reservation' | 'block'
export type ReservationStatus = 'confirmed' | 'active' | 'cancelled'

export type Reservation = {
  id: string
  club_id: string
  court_id: string
  customer_name: string | null
  person_id: string | null
  starts_at: string
  ends_at: string
  status: ReservationStatus
  occupation_type: OccupationType
  block_reason: string | null
  recurrence_series_id: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type ReservationDraft = {
  clubId: string
  courtId: string
  date: string
  startsAt: string
  endsAt: string
  customerName: string
  personId: string | null
  notes: string
  recurrence: 'single' | 'weekly'
  recurrenceUntil: string
}

export type ClubPerson = {
  id: string
  club_id: string
  full_name: string
  phone: string | null
  email: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type ClubMembershipStatus = 'active' | 'inactive'

export type ClubMembershipRecord = {
  id: string
  club_id: string
  person_id: string
  status: ClubMembershipStatus
  joined_on: string | null
  created_at: string
  updated_at: string
}

export type ClubFeeSettings = {
  club_id: string
  monthly_amount_cents: number
  due_day: number
  currency: 'ARS'
  updated_at: string
  updated_by: string
}

export type MembershipDue = {
  id: string
  club_id: string
  membership_id: string
  period: string
  amount_cents: number
  due_date: string
  created_at: string
  created_by: string
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'mercado_pago' | 'other'

export type MembershipDuePayment = {
  id: string
  club_id: string
  due_id: string
  amount_cents: number
  payment_date: string
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  created_at: string
  created_by: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type BlockDraft = {
  clubId: string
  courtId: string
  date: string
  startsAt: string
  endsAt: string
  reason: string
  notes: string
}
