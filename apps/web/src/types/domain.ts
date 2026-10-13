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

export type ReservationStatus = 'confirmed' | 'cancelled'

export type Reservation = {
  id: string
  club_id: string
  court_id: string
  customer_name: string
  starts_at: string
  ends_at: string
  status: ReservationStatus
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
  notes: string
}
