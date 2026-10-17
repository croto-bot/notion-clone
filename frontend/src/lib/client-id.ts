/**
 * Identifies this tab to the backend: generated once per tab (module scope,
 * so every tab of a user has its own), sent as `X-Client-Id` on every request
 * and echoed back on this tab's workspace events as `client_id`. The events
 * hook skips those: this tab's own mutations already own their caches, and
 * their invalidation refetch can read pre-commit state and land over the
 * optimistic paint. The user's other tabs have their own id and still
 * refresh (docs/SPEC.md §WebSockets).
 */
export const clientId =
  // crypto.randomUUID only exists in secure contexts (https/localhost); fall
  // back like ErrorBoundary does rather than crash the app on an odd origin.
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
