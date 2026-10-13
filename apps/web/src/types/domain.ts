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

export type OccupationType = 'reservation' | 'block' | 'lesson' | 'tournament_match'
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

export type CanteenCategory = { id: string; club_id: string; name: string; active: boolean; created_at: string; updated_at: string }
export type CanteenProduct = { id: string; club_id: string; category_id: string; name: string; sale_price_cents: number; active: boolean; created_at: string; updated_at: string }
export type CanteenSale = {
  id: string; club_id: string; customer_person_id: string | null; total_cents: number; status: 'confirmed' | 'voided'
  client_request_id: string; created_at: string; created_by: string; voided_at: string | null; voided_by: string | null; void_reason: string | null
}
export type CanteenSaleItem = { id: string; club_id: string; sale_id: string; product_id: string; product_name_snapshot: string; quantity: number; unit_price_cents: number; created_at: string }
export type CanteenSalePayment = {
  id: string; club_id: string; sale_id: string; amount_cents: number; payment_date: string; payment_method: PaymentMethod
  reference: string | null; notes: string | null; created_at: string; created_by: string
}

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

export type ClubCoach = {
  id: string
  club_id: string
  person_id: string
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type TennisLesson = {
  id: string
  club_id: string
  coach_id: string
  reservation_id: string
  lesson_type: 'individual' | 'group'
  capacity: number
  status: 'scheduled' | 'cancelled'
  notes: string | null
  recurrence_series_id: string | null
  created_at: string
  updated_at: string
}

export type TennisLessonStudent = {
  lesson_id: string
  club_id: string
  person_id: string
}

export type LessonDraft = {
  coachId: string
  courtId: string
  date: string
  startsAt: string
  endsAt: string
  lessonType: 'individual' | 'group'
  capacity: number
  studentIds: string[]
  notes: string
  recurrence: 'single' | 'weekly'
  recurrenceUntil: string
}

export type TournamentStatus = 'draft' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled'
export type TournamentCategoryStatus = 'open' | 'fixture_generated' | 'completed' | 'cancelled'

export type Tournament = {
  id: string
  club_id: string
  name: string
  description: string | null
  starts_on: string
  ends_on: string
  status: TournamentStatus
  created_at: string
}

export type TournamentCategory = {
  id: string
  club_id: string
  tournament_id: string
  name: string
  modality: 'singles' | 'doubles'
  status: TournamentCategoryStatus
  champion_entry_id: string | null
}

export type TournamentEntry = { id: string; club_id: string; category_id: string; display_name: string; draw_position: number | null }
export type TournamentEntryMember = { entry_id: string; category_id: string; club_id: string; person_id: string; person_name_snapshot: string }
export type TournamentMatch = {
  id: string; club_id: string; tournament_id: string; category_id: string; round_number: number; position: number
  entry_one_id: string | null; entry_two_id: string | null; winner_entry_id: string | null; reservation_id: string | null
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled'; score_text: string | null; is_walkover: boolean; finished_at: string | null
}
