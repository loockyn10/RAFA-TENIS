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
