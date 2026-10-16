export type Role = 'owner' | 'editor' | 'viewer'

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer']

export interface Workspace {
  id: string
  name: string
  /** An emoji, or null for the default letter badge. */
  icon: string | null
  owner_id: string
  /** My role in this workspace. */
  role: Role
  created_at: string
  updated_at: string
}

export interface CreateWorkspaceData {
  name: string
  icon?: string | null
}

export interface UpdateWorkspaceData {
  name?: string
  icon?: string | null
}

export interface Member {
  user_id: string
  email: string
  display_name: string
  role: Role
  joined_at: string
}

export interface AddMemberData {
  email: string
  role: Role
}

export interface UpdateMemberData {
  role: Role
}
