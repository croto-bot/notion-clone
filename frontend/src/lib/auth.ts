/** localStorage key of the session token. The e2e fixtures use it to sign users in. */
export const AUTH_TOKEN_KEY = 'auth_token'

// Subscribers are notified whenever the auth token changes — allows api-client
// to trigger AuthContext re-renders when it clears the token on 401.
type AuthChangeListener = () => void
const authChangeListeners = new Set<AuthChangeListener>()

export function subscribeToAuthChanges(listener: AuthChangeListener): () => void {
  authChangeListeners.add(listener)
  return () => authChangeListeners.delete(listener)
}

function notifyAuthChange() {
  authChangeListeners.forEach(listener => listener())
}

/** Tells the auth subscribers to re-read the stored token.
 *
 * For a session another tab already cleared or replaced: this tab's cached
 * snapshot is stale, and without a notification it never re-reads it (so a
 * signed-out-everywhere user would stay on the page until reload).
 */
export function announceAuthToken() {
  notifyAuthChange()
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  notifyAuthChange()
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  notifyAuthChange()
}
