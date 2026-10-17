import { getConfig } from './config'

/** `http://host:port` becomes `ws://host:port`; `https` becomes `wss`. */
export function wsBaseUrl(): string {
  return getConfig().apiBaseUrl.replace(/^http/, 'ws')
}

/** A full socket URL. Browsers cannot set headers on a WebSocket: the session goes in `?token=`. */
export function wsUrl(path: string, token: string): string {
  return `${wsBaseUrl()}${path}?${new URLSearchParams({ token })}`
}

/** Close codes the backend uses on a socket (docs/SPEC.md section 3). */
export const WS_CLOSE_UNAUTHORIZED = 4401
export const WS_CLOSE_NOT_FOUND = 4404
