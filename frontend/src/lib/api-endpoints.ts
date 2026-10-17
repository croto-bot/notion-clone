export const API = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
  },
  USERS: {
    ME: '/users/me', // GET, PATCH
  },
  WORKSPACES: {
    LIST: '/workspaces',
    CREATE: '/workspaces',
    DETAIL: (id: string) => `/workspaces/${id}`, // PATCH, DELETE
    MEMBERS: (id: string) => `/workspaces/${id}/members`, // GET, POST
    MEMBER: (id: string, userId: string) => `/workspaces/${id}/members/${userId}`, // PATCH, DELETE
    PAGE_TREE: (id: string) => `/workspaces/${id}/page-tree`,
    TRASH: (id: string) => `/workspaces/${id}/trash`,
    RECENT: (id: string) => `/workspaces/${id}/recent`,
    SEARCH: (id: string) => `/workspaces/${id}/search`,
    FAVORITES: (id: string) => `/workspaces/${id}/favorites`,
  },
  PAGES: {
    CREATE: '/pages',
    DETAIL: (id: string) => `/pages/${id}`, // GET, PATCH, DELETE
    MOVE: (id: string) => `/pages/${id}/move`,
    DUPLICATE: (id: string) => `/pages/${id}/duplicate`,
    RESTORE: (id: string) => `/pages/${id}/restore`,
    PERMANENT: (id: string) => `/pages/${id}/permanent`,
    ROWS: (id: string) => `/pages/${id}/rows`,
    DOCUMENT: (id: string) => `/pages/${id}/document`, // GET, PUT
    FAVORITE: (id: string) => `/pages/${id}/favorite`, // PUT, DELETE
    COMMENTS: (id: string) => `/pages/${id}/comments`, // GET, POST
  },
  COMMENTS: {
    DETAIL: (id: string) => `/comments/${id}`, // PATCH, DELETE
  },
  PUBLIC: {
    PAGE: (publicId: string) => `/public/pages/${publicId}`,
  },
  /** WebSocket paths. Browsers cannot set headers on a socket: the session goes in `?token=`. */
  WS: {
    PAGE_COLLAB: (id: string) => `/pages/${id}/collab`,
    WORKSPACE_EVENTS: (id: string) => `/workspaces/${id}/events`,
  },
} as const

/** The trash list of a workspace, optionally filtered by `q`. */
export function buildTrashUrl(workspaceId: string, q?: string): string {
  const base = API.WORKSPACES.TRASH(workspaceId)
  return q ? `${base}?${new URLSearchParams({ q })}` : base
}

/** The pages I visited last, newest first. */
export function buildRecentUrl(workspaceId: string, limit?: number): string {
  const base = API.WORKSPACES.RECENT(workspaceId)
  return limit ? `${base}?${new URLSearchParams({ limit: String(limit) })}` : base
}

/** Title and text search in one workspace. */
export function buildSearchUrl(workspaceId: string, q: string, limit?: number): string {
  const params = new URLSearchParams({ q })
  if (limit) params.set('limit', String(limit))
  return `${API.WORKSPACES.SEARCH(workspaceId)}?${params}`
}
