import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useAuth } from '@/contexts/AuthContext'
import { displayNameOf, useCurrentUser } from '@/hooks/useUser'
import { API } from '@/lib/api-endpoints'
import { colorForUser } from '@/lib/colors'
import { createValueStore } from '@/lib/value-store'
import { WS_CLOSE_NOT_FOUND, WS_CLOSE_UNAUTHORIZED, wsBaseUrl } from '@/lib/ws'

/** The Yjs XML fragment BlockNote binds to, and the server reads for search. */
export const DOCUMENT_FRAGMENT = 'document-store'

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

export interface PresenceUser {
  clientId: number
  id: string
  name: string
  color: string
}

export interface CollabSession {
  doc: Y.Doc
  provider: WebsocketProvider
  status: CollabStatus
  /** Other people on the page, once per person (a person with two tabs shows once). */
  users: PresenceUser[]
  /**
   * True once this provider has completed a sync, until the provider is
   * destroyed. A drop makes `synced` false while the socket retries (y-websocket
   * 3.1.0 emits `disconnected` once and then `connecting` on every retry, about
   * every 200 ms..2.5 s), so `synced` alone would unmount a healthy editor on
   * every network blip. Once synced, the editor stays mounted: local edits wait
   * in the Yjs doc and merge on reconnect (SPEC F6).
   */
  hasSynced: boolean
  /**
   * True once the server refused this page's socket for good (4401/4404):
   * retrying is pointless, so the editor mounts on the empty document as-is.
   * Any other close is a blip (the socket retries), not a verdict: mounting
   * then would hand the user an editable empty document before the first sync.
   */
  terminal: boolean
  user: { id: string; name: string; color: string }
}

interface Live {
  doc: Y.Doc
  provider: WebsocketProvider
}

function readUsers(provider: WebsocketProvider, myId: string): PresenceUser[] {
  const seen = new Set<string>([myId])
  const users: PresenceUser[] = []
  provider.awareness.getStates().forEach((state, clientId) => {
    if (clientId === provider.awareness.clientID) return
    const user = state['user'] as { id?: string; name?: string; color?: string } | undefined
    if (!user?.name) return
    const id = user.id ?? `client-${clientId}`
    if (seen.has(id)) return
    seen.add(id)
    users.push({ clientId, id, name: user.name, color: user.color ?? colorForUser(id) })
  })
  return users
}

/**
 * Opens the collaboration socket of a page (`WS /pages/{id}/collab`, the
 * y-websocket protocol) and exposes the Yjs document, the connection status and
 * who else is on the page. Returns null until the session exists.
 */
export function useCollabSession(pageId: string): CollabSession | null {
  const { token } = useAuth()
  const { data: me } = useCurrentUser()
  // The doc and provider are created in the effect below (they own a socket), so they are
  // published through a store instead of state.
  const [store] = useState(() => createValueStore<Live | null>(null))
  const live = useSyncExternalStore(store.subscribe, store.get, () => null)
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [hasSynced, setHasSynced] = useState(false)
  const [terminal, setTerminal] = useState(false)
  const [users, setUsers] = useState<PresenceUser[]>([])

  const myId = me?.id
  const myName = me ? displayNameOf(me) : undefined
  // The identity the socket should speak for. Kept in a ref (updated before
  // the effects below run) so a display-name change does not become a
  // dependency of the socket's lifecycle: one provider per page and token.
  const identityRef = useRef<{ id: string; name: string } | null>(null)
  useEffect(() => {
    identityRef.current = myId && myName ? { id: myId, name: myName } : null
  })
  const identityReady = !!myId && !!myName

  useEffect(() => {
    const identity = identityRef.current
    if (!token || !identity) return
    const doc = new Y.Doc()
    // y-websocket joins `${serverUrl}/${roomName}?${params}`: this is `/pages/{id}/collab?token=…`.
    const provider = new WebsocketProvider(wsBaseUrl(), API.WS.PAGE_COLLAB(pageId).slice(1), doc, {
      params: { token },
    })
    provider.awareness.setLocalStateField('user', {
      id: identity.id,
      name: identity.name,
      color: colorForUser(identity.id),
    })

    const onStatus = ({ status: next }: { status: CollabStatus }) => setStatus(next)
    // `hasSynced` latches on the first sync and is only cleared when this
    // provider goes away (the cleanup below).
    const onSync = (isSynced: boolean) => {
      if (isSynced) setHasSynced(true)
    }
    const onAwareness = () => setUsers(readUsers(provider, identity.id))
    const onClose = (event: CloseEvent | null) => {
      // The backend refuses with these codes: retrying would loop forever, and
      // the page is not coming back on this socket. The editor may mount on
      // the empty document instead of waiting for a sync that will not come.
      if (event && (event.code === WS_CLOSE_UNAUTHORIZED || event.code === WS_CLOSE_NOT_FOUND)) {
        setTerminal(true)
        provider.disconnect()
      }
    }
    provider.on('status', onStatus)
    provider.on('sync', onSync)
    provider.on('connection-close', onClose)
    provider.awareness.on('change', onAwareness)

    store.set({ doc, provider })
    return () => {
      provider.off('status', onStatus)
      provider.off('sync', onSync)
      provider.off('connection-close', onClose)
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      doc.destroy()
      store.set(null)
      setStatus('connecting')
      setHasSynced(false)
      setTerminal(false)
      setUsers([])
    }
  }, [pageId, token, identityReady, store])

  // A display-name change reaches the room as an in-place awareness update:
  // the same provider, the same doc, the editor and its history stay put.
  useEffect(() => {
    if (!live || !myId || !myName) return
    live.provider.awareness.setLocalStateField('user', {
      id: myId,
      name: myName,
      color: colorForUser(myId),
    })
  }, [live, myId, myName])

  if (!live || !myId || !myName) return null
  return {
    ...live,
    status,
    hasSynced,
    terminal,
    users,
    user: { id: myId, name: myName, color: colorForUser(myId) },
  }
}
