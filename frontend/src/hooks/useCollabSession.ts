import { useEffect, useState, useSyncExternalStore } from 'react'
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
  /** True after the first sync with the server: the document is complete. */
  synced: boolean
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
  const [synced, setSynced] = useState(false)
  const [users, setUsers] = useState<PresenceUser[]>([])

  const myId = me?.id
  const myName = me ? displayNameOf(me) : undefined

  useEffect(() => {
    if (!token || !myId || !myName) return
    const doc = new Y.Doc()
    // y-websocket joins `${serverUrl}/${roomName}?${params}`: this is `/pages/{id}/collab?token=…`.
    const provider = new WebsocketProvider(wsBaseUrl(), API.WS.PAGE_COLLAB(pageId).slice(1), doc, {
      params: { token },
    })
    provider.awareness.setLocalStateField('user', {
      id: myId,
      name: myName,
      color: colorForUser(myId),
    })

    const onStatus = ({ status: next }: { status: CollabStatus }) => setStatus(next)
    const onSync = (isSynced: boolean) => setSynced(isSynced)
    const onAwareness = () => setUsers(readUsers(provider, myId))
    const onClose = (event: CloseEvent | null) => {
      // The backend refuses with these codes: retrying would loop forever.
      if (event && (event.code === WS_CLOSE_UNAUTHORIZED || event.code === WS_CLOSE_NOT_FOUND)) {
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
      setSynced(false)
      setUsers([])
    }
  }, [pageId, token, myId, myName, store])

  if (!live || !myId || !myName) return null
  return {
    ...live,
    status,
    synced,
    users,
    user: { id: myId, name: myName, color: colorForUser(myId) },
  }
}
