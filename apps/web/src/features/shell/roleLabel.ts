import type { ClubRole } from '../../types/domain'

const ROLE_LABEL: Record<ClubRole, string> = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal operativo' }

export const roleLabel = (role: ClubRole | undefined) => (role ? ROLE_LABEL[role] : 'Sin rol')
