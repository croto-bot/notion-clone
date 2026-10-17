/** One JSON message of `WS /workspaces/{id}/events`. */
export type WorkspaceEventType =
  | 'page.created'
  | 'page.updated'
  | 'page.moved'
  | 'page.deleted'
  | 'page.restored'
  | 'page.purged'
  | 'comment.changed'
  | 'members.changed'
  | 'workspace.updated'

export interface WorkspaceEvent {
  type: WorkspaceEventType
  page_id?: string | null
  actor_id: string
  /** The tab that made the change (`X-Client-Id`), when it sent a UUID. */
  client_id?: string
}
