/** `GET /users/me` */
export interface CurrentUser {
  id: string
  email: string
  display_name: string
  email_verified_at: string | null
  is_email_verified: boolean
}

export interface UpdateCurrentUserData {
  display_name?: string
}
