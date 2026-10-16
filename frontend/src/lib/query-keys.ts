export const queryKeys = {
  user: {
    me: ['user', 'me'] as const,
  },
  workspaces: {
    all: ['workspaces'] as const,
    list: ['workspaces', 'list'] as const,
    members: (workspaceId: string) => ['workspaces', 'members', workspaceId] as const,
  },
  pages: {
    all: ['pages'] as const,
    tree: (workspaceId: string) => ['pages', 'tree', workspaceId] as const,
    detail: (pageId: string) => ['pages', 'detail', pageId] as const,
    rows: (pageId: string) => ['pages', 'rows', pageId] as const,
    trash: (workspaceId: string, q: string) => ['pages', 'trash', workspaceId, q] as const,
    recent: (workspaceId: string, limit: number) =>
      ['pages', 'recent', workspaceId, limit] as const,
    search: (workspaceId: string, q: string) => ['pages', 'search', workspaceId, q] as const,
    favorites: (workspaceId: string) => ['pages', 'favorites', workspaceId] as const,
  },
  comments: {
    all: ['comments'] as const,
    list: (pageId: string) => ['comments', 'list', pageId] as const,
  },
  publicPages: {
    detail: (publicId: string) => ['public-pages', publicId] as const,
  },
}
