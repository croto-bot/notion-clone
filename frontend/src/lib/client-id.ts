/**
 * Identifies this tab to the backend. One UUID per tab (module scope, so every
 * tab of a user has its own). Sent as `X-Client-Id` on every HTTP request and
 * as `client_id` on the collab socket. The backend echoes it on workspace
 * events. The events hook skips an event only when the id matches and this tab
 * has a pending or just-settled mutation of that page (docs/SPEC.md §WebSockets).
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const byte6 = bytes[6] ?? 0
  const byte8 = bytes[8] ?? 0
  bytes[6] = (byte6 & 0x0f) | 0x40
  bytes[8] = (byte8 & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const clientId = randomUuid()
