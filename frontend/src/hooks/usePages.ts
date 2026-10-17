import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api-client'
import { API, buildRecentUrl, buildSearchUrl, buildTrashUrl } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import {
  invalidatePageLists,
  patchPageContent,
  patchPageEverywhere,
  storePageResponse,
} from '@/features/pages/page-cache'
import { moveInList, removeSubtree } from '@/features/pages/page-tree'
import type {
  CreatePageData,
  MovePageData,
  DocumentResponse,
  PageResponse,
  PageSummary,
  SearchResult,
  UpdatePageData,
} from '@/types/page'

export function usePageTree(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pages.tree(workspaceId ?? ''),
    queryFn: () => api.get<PageSummary[]>(API.WORKSPACES.PAGE_TREE(workspaceId!)),
    enabled: !!workspaceId,
    // The events socket keeps it fresh.
    staleTime: 5 * 60 * 1000,
  })
}

/** One page. Every load records a visit on the backend, so it reloads each time the page opens. */
export function usePage(pageId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pages.detail(pageId ?? ''),
    queryFn: () => api.get<PageResponse>(API.PAGES.DETAIL(pageId!)),
    enabled: !!pageId,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

/** The rows of a database page (pages whose parent is the database). */
export function usePageRows(pageId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pages.rows(pageId ?? ''),
    queryFn: () => api.get<PageResponse[]>(API.PAGES.ROWS(pageId!)),
    enabled: !!pageId && enabled,
    staleTime: 60 * 1000,
  })
}

export function useFavorites(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pages.favorites(workspaceId ?? ''),
    queryFn: () => api.get<PageSummary[]>(API.WORKSPACES.FAVORITES(workspaceId!)),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useRecentPages(workspaceId: string | undefined, limit = 12, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pages.recent(workspaceId ?? '', limit),
    queryFn: () => api.get<PageSummary[]>(buildRecentUrl(workspaceId!, limit)),
    enabled: !!workspaceId && enabled,
    staleTime: 0,
  })
}

export function useTrash(workspaceId: string | undefined, q: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pages.trash(workspaceId ?? '', q),
    queryFn: () => api.get<PageSummary[]>(buildTrashUrl(workspaceId!, q)),
    enabled: !!workspaceId && enabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}

export function useSearchPages(workspaceId: string | undefined, q: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pages.search(workspaceId ?? '', q),
    queryFn: () => api.get<SearchResult[]>(buildSearchUrl(workspaceId!, q, 20)),
    enabled: !!workspaceId && enabled && q.trim().length > 0,
    staleTime: 10 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreatePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePageData) => api.post<PageResponse>(API.PAGES.CREATE, data),
    onSuccess: page => {
      queryClient.setQueryData(queryKeys.pages.detail(page.id), page)
      invalidatePageLists(queryClient)
    },
  })
}

/** Sequence number of the newest update mutation per page: an older mutation's
 * response must never overwrite what a newer one already wrote to the cache. */
const updateMutationClock = new Map<string, number>()

export function useUpdatePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePageData }) =>
      api.patch<PageResponse>(API.PAGES.DETAIL(id), data),
    onMutate: async ({ id, data }) => {
      // Sequence this mutation: a slower older response is dropped in onSuccess.
      const at = (updateMutationClock.get(id) ?? 0) + 1
      updateMutationClock.set(id, at)
      // Cancel in-flight reads first: a fetch that started before
      // the change would resolve after the optimistic patch and clobber it
      // (a filter or favorite that visibly "jumps back"). Row edits are cached
      // under the database's rows key, not the row's, so cancel the prefix.
      await queryClient.cancelQueries({ queryKey: ['pages', 'detail', id] })
      await queryClient.cancelQueries({ queryKey: ['pages', 'rows'] })
      patchPageContent(queryClient, id, data)
      const patch: Parameters<typeof patchPageEverywhere>[2] = {}
      if (data.title !== undefined) patch.title = data.title
      if (data.icon !== undefined) patch.icon = data.icon
      if (data.is_public !== undefined) patch.is_public = data.is_public
      if (Object.keys(patch).length > 0) patchPageEverywhere(queryClient, id, patch)
      return { at }
    },
    onSuccess: (page, { id }, context) => {
      // A newer mutation for the same page already answered (or will): storing
      // this older response would write its stale title/properties back.
      if (context && updateMutationClock.get(id) !== context.at) return
      storePageResponse(queryClient, page)
    },
    onError: (_error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) })
      invalidatePageLists(queryClient)
    },
  })
}

interface TreeSnapshot {
  tree: [readonly unknown[], PageSummary[] | undefined][]
  favorites: [readonly unknown[], PageSummary[] | undefined][]
}

function snapshotLists(queryClient: QueryClient): TreeSnapshot {
  return {
    tree: queryClient.getQueriesData<PageSummary[]>({ queryKey: ['pages', 'tree'] }),
    favorites: queryClient.getQueriesData<PageSummary[]>({ queryKey: ['pages', 'favorites'] }),
  }
}

function restoreLists(queryClient: QueryClient, snapshot: TreeSnapshot | undefined) {
  if (!snapshot) return
  for (const [key, data] of [...snapshot.tree, ...snapshot.favorites]) {
    queryClient.setQueryData(key, data)
  }
}

export function useMovePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & MovePageData) =>
      api.post<PageResponse>(API.PAGES.MOVE(id), data),
    onMutate: async ({ id, parent_id, after_id }) => {
      await queryClient.cancelQueries({ queryKey: ['pages', 'tree'] })
      const snapshot = snapshotLists(queryClient)
      queryClient.setQueriesData<PageSummary[]>({ queryKey: ['pages', 'tree'] }, old =>
        old ? moveInList(old, id, parent_id, after_id) : old
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => restoreLists(queryClient, context?.snapshot),
    onSettled: (_data, _error, { id }) => {
      invalidatePageLists(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) })
    },
  })
}

export function useDuplicatePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<PageResponse>(API.PAGES.DUPLICATE(id), {}),
    onSuccess: () => invalidatePageLists(queryClient),
  })
}

export function useDeletePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(API.PAGES.DETAIL(id)),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: ['pages', 'tree'] })
      const snapshot = snapshotLists(queryClient)
      queryClient.setQueriesData<PageSummary[]>({ queryKey: ['pages', 'tree'] }, old =>
        old ? removeSubtree(old, id) : old
      )
      queryClient.setQueriesData<PageSummary[]>({ queryKey: ['pages', 'favorites'] }, old =>
        old?.filter(page => page.id !== id)
      )
      queryClient.setQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] }, old =>
        old?.filter(row => row.id !== id)
      )
      return { snapshot }
    },
    onError: (_error, _id, context) => {
      restoreLists(queryClient, context?.snapshot)
      void queryClient.invalidateQueries({ queryKey: ['pages', 'rows'] })
    },
    onSettled: (_data, _error, id) => {
      invalidatePageLists(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) })
    },
  })
}

export function useRestorePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<PageResponse>(API.PAGES.RESTORE(id), {}),
    onSuccess: page => {
      queryClient.setQueryData(queryKeys.pages.detail(page.id), page)
      invalidatePageLists(queryClient)
    },
  })
}

export function usePurgePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(API.PAGES.PERMANENT(id)),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.pages.detail(id) })
      invalidatePageLists(queryClient)
    },
  })
}

export function usePutDocument() {
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: string }) =>
      api.put<DocumentResponse>(API.PAGES.DOCUMENT(id), { state }),
  })
}

export function useSetFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ page, favorite }: { page: PageSummary; favorite: boolean }) =>
      favorite
        ? api.put<void>(API.PAGES.FAVORITE(page.id), {})
        : api.delete(API.PAGES.FAVORITE(page.id)),
    onMutate: async ({ page, favorite }) => {
      await queryClient.cancelQueries({ queryKey: ['pages', 'favorites'] })
      // The detail cache holds is_favorite too; an in-flight fetch that
      // predates the toggle must not clobber the optimistic patch.
      await queryClient.cancelQueries({ queryKey: ['pages', 'detail', page.id] })
      const snapshot = snapshotLists(queryClient)
      queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(page.id), old =>
        old ? { ...old, is_favorite: favorite } : old
      )
      queryClient.setQueriesData<PageSummary[]>({ queryKey: ['pages', 'favorites'] }, old => {
        if (!old) return old
        if (!favorite) return old.filter(item => item.id !== page.id)
        return old.some(item => item.id === page.id) ? old : [...old, page]
      })
      return { snapshot }
    },
    onError: (_error, { page }, context) => {
      restoreLists(queryClient, context?.snapshot)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['pages', 'favorites'] })
    },
  })
}
