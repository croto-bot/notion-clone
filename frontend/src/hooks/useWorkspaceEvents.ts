import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { API } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import { WS_CLOSE_NOT_FOUND, WS_CLOSE_UNAUTHORIZED, wsUrl } from '@/lib/ws'
import { invalidatePageLists } from '@/features/pages/page-cache'
import type { WorkspaceEvent } from '@/types/events'

type Refresh = 'pages' | 'comments' | 'members' | 'workspaces'

function refreshFor(event: WorkspaceEvent): Refresh[] {
  switch (event.type) {
    case 'page.created':
    case 'page.updated':
    case 'page.moved':
    case 'page.deleted':
    case 'page.restored':
    case 'page.purged':
      return ['pages']
    case 'comment.changed':
      return ['comments']
    case 'members.changed':
      return ['members', 'workspaces']
    case 'workspace.updated':
      return ['workspaces']
    default:
      return []
  }
}

function flush(queryClient: QueryClient, workspaceId: string, kinds: ReadonlySet<Refresh>) {
  if (kinds.has('pages')) {
    invalidatePageLists(queryClient)
    // Titles, icons, breadcrumbs and `has_children` of the open pages.
    void queryClient.invalidateQueries({ queryKey: ['pages', 'detail'] })
  }
  if (kinds.has('comments'))
    void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all })
  if (kinds.has('members')) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) })
  }
  if (kinds.has('workspaces')) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list })
  }
}

const MAX_BACKOFF_MS = 30_000
/** Events of one burst (a typing user stores the page about once a second) reload the queries once. */
const COALESCE_MS = 250

/**
 * Keeps the open workspace live: connects to `WS /workspaces/{id}/events` and
 * reloads the matching queries when a member changes something. Reconnects with
 * a growing delay; after a reconnect everything is reloaded, since events may
 * have been missed.
 */
export function useWorkspaceEvents(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  const { token } = useAuth()

  useEffect(() => {
    if (!workspaceId || !token) return

    let socket: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set<Refresh>()

    const schedule = (kinds: Refresh[]) => {
      kinds.forEach(kind => pending.add(kind))
      if (flushTimer !== undefined) return
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        const kindsNow = new Set(pending)
        pending.clear()
        flush(queryClient, workspaceId, kindsNow)
      }, COALESCE_MS)
    }

    const connect = () => {
      socket = new WebSocket(wsUrl(API.WS.WORKSPACE_EVENTS(workspaceId), token))
      socket.onopen = () => {
        attempt = 0
        // Reload on every open, including the first: events published while
        // the socket was still connecting (before the server subscribed it)
        // would otherwise never reach this tab.
        schedule(['pages', 'comments', 'members', 'workspaces'])
      }
      socket.onmessage = message => {
        try {
          schedule(refreshFor(JSON.parse(String(message.data)) as WorkspaceEvent))
        } catch {
          // Not JSON: ignore.
        }
      }
      socket.onclose = event => {
        if (stopped || event.code === WS_CLOSE_UNAUTHORIZED || event.code === WS_CLOSE_NOT_FOUND) {
          return
        }
        reconnectTimer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++))
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      clearTimeout(flushTimer)
      socket?.close()
    }
  }, [workspaceId, token, queryClient])
}
