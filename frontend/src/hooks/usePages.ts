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
  cancelPageLists,
  invalidatePageLists,
  invalidateRowsOf,
  patchPageContent,
  patchPageEverywhere,
  rollbackOptimisticTitle,
  rowsKeyOf,
  storePageResponse,
} from '@/features/pages/page-cache'
import {
  isStalePageMutation,
  runPageMutation,
  trackPageMutation,
} from '@/features/pages/page-mutations'
import { moveInList, removeSubtree } from '@/features/pages/page-tree'
import type {
  CreatePageData,
  MovePageData,
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

/** The rows caches (one per database) that currently hold this row. */
function rowsCachesHolding(
  queryClient: QueryClient,
  rowId: string
): readonly (readonly unknown[])[] {
  return queryClient
    .getQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] })
    .filter(([, rows]) => rows?.some(row => row.id === rowId))
    .map(([key]) => key)
}

/** Reads whose in-flight response could land over a write about to hit this
 * page: its detail, its database's rows, every rows cache holding it. */
async function cancelPageReads(queryClient: QueryClient, id: string) {
  await queryClient.cancelQueries({ queryKey: ['pages', 'detail', id] })
  const rowsKey = rowsKeyOf(queryClient, id)
  if (rowsKey) await queryClient.cancelQueries({ queryKey: rowsKey })
  for (const key of rowsCachesHolding(queryClient, id)) {
    await queryClient.cancelQueries({ queryKey: key })
  }
}

interface UpdateSnapshot {
  detail: PageResponse | undefined
  lists: TreeSnapshot
  rows: [readonly unknown[], PageResponse[] | undefined][]
}

function snapshotPage(queryClient: QueryClient, id: string): UpdateSnapshot {
  return {
    detail: queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(id)),
    lists: snapshotLists(queryClient),
    rows: queryClient
      .getQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] })
      .filter(([, rows]) => rows?.some(row => row.id === id)),
  }
}

function restorePage(queryClient: QueryClient, id: string, snapshot: UpdateSnapshot) {
  queryClient.setQueryData(queryKeys.pages.detail(id), snapshot.detail)
  restoreLists(queryClient, snapshot.lists)
  for (const [key, rows] of snapshot.rows) queryClient.setQueryData(key, rows)
}

export function useUpdatePage() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({
      id,
      data,
      wait,
    }: {
      id: string
      data: UpdatePageData
      wait: Promise<unknown>
      seq: number
    }) => wait.then(() => api.patch<PageResponse>(API.PAGES.DETAIL(id), data)),
    onMutate: async ({ id, data, seq }) => {
      // Cancel in-flight reads first: a fetch that started before the change
      // would resolve after the optimistic patch and clobber it. A later
      // update of this page already owns the paint; patching here would
      // write this call's older values over it.
      await cancelPageReads(queryClient, id)
      await cancelPageLists(queryClient)
      const snapshot = snapshotPage(queryClient, id)
      if (isStalePageMutation(id, 'update', seq)) return { snapshot }
      patchPageContent(queryClient, id, data)
      const patch: Parameters<typeof patchPageEverywhere>[2] = {}
      if (data.title !== undefined) patch.title = data.title
      if (data.icon !== undefined) patch.icon = data.icon
      if (data.is_public !== undefined) patch.is_public = data.is_public
      if (Object.keys(patch).length > 0) patchPageEverywhere(queryClient, id, patch)
      return { snapshot }
    },
    onSuccess: async (page, { id, data, seq }) => {
      // Breadcrumbs of an open descendant carry this page's title and icon.
      // This tab skips its own page.updated, so it refetches them here. The
      // page's own detail is left alone: the stored response owns it.
      if (data.title !== undefined || data.icon !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: ['pages', 'detail'],
          predicate: query =>
            (query.state.data as PageResponse | undefined)?.breadcrumbs.some(
              crumb => crumb.id === id
            ) ?? false,
        })
      }
      // A read that started before the commit can still be in flight; its
      // response would land right after this store and revert it (the views
      // list unmounted the open "Delete view" menu under the pointer).
      await cancelPageReads(queryClient, id)
      if (isStalePageMutation(id, 'update', seq)) return
      storePageResponse(queryClient, page)
      // A row PATCH does not paint the server's merged properties into the
      // rows caches: the rows list refetches instead (the row it renders
      // carries more than properties, and another member's key may be in the
      // same merge).
      invalidateRowsOf(queryClient, id, page.parent_id)
    },
    onError: (_error, { id, seq }, context) => {
      // A newer update owns the paint. Restoring this call's snapshot would
      // put the older title back over it.
      if (isStalePageMutation(id, 'update', seq)) return
      if (context?.snapshot) restorePage(queryClient, id, context.snapshot)
      rollbackOptimisticTitle(queryClient, id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) })
      invalidateRowsOf(queryClient, id)
      invalidatePageLists(queryClient)
    },
  })
  return {
    mutateAsync: (variables: { id: string; data: UpdatePageData }) =>
      runPageMutation(variables.id, 'update', (wait, seq) =>
        mutation.mutateAsync({ ...variables, wait, seq })
      ),
  }
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
  const mutation = useMutation({
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
    onSettled: () => {
      // Breadcrumbs of an open descendant live on that page's detail, not on
      // the moved page. Search results carry the same chain. Lists (including
      // search) and every open detail refetch after the move commits.
      invalidatePageLists(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['pages', 'detail'] })
    },
  })
  return {
    mutateAsync: (variables: { id: string } & MovePageData) =>
      trackPageMutation(variables.id, () => mutation.mutateAsync(variables)),
  }
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
  const mutation = useMutation({
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
  return {
    mutateAsync: (id: string) => trackPageMutation(id, () => mutation.mutateAsync(id)),
  }
}

export function useRestorePage() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => api.post<PageResponse>(API.PAGES.RESTORE(id), {}),
    onSuccess: page => {
      queryClient.setQueryData(queryKeys.pages.detail(page.id), page)
      invalidatePageLists(queryClient)
    },
  })
  return {
    mutateAsync: (id: string) => trackPageMutation(id, () => mutation.mutateAsync(id)),
  }
}

export function usePurgePage() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => api.delete(API.PAGES.PERMANENT(id)),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.pages.detail(id) })
      invalidatePageLists(queryClient)
    },
  })
  return {
    mutateAsync: (id: string) => trackPageMutation(id, () => mutation.mutateAsync(id)),
  }
}

export function useSetFavorite() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({
      page,
      favorite,
      wait,
    }: {
      page: PageSummary
      favorite: boolean
      wait: Promise<unknown>
      seq: number
    }) =>
      wait.then(() =>
        favorite
          ? api.put<void>(API.PAGES.FAVORITE(page.id), {})
          : api.delete(API.PAGES.FAVORITE(page.id))
      ),
    onMutate: async ({ page, favorite, seq }) => {
      await queryClient.cancelQueries({ queryKey: ['pages', 'favorites'] })
      // The detail cache holds is_favorite too; an in-flight fetch that
      // predates the toggle must not clobber the optimistic patch.
      await queryClient.cancelQueries({ queryKey: ['pages', 'detail', page.id] })
      const snapshot = snapshotLists(queryClient)
      if (isStalePageMutation(page.id, 'favorite', seq)) return { snapshot }
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
    onError: (_error, { page, seq }, context) => {
      if (isStalePageMutation(page.id, 'favorite', seq)) return
      restoreLists(queryClient, context?.snapshot)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id) })
    },
    onSettled: async (_data, error, { page, favorite, seq }) => {
      // On error the optimistic star is wrong and onError has already queued
      // the repair refetch: writing `is_favorite` here (or cancelling that
      // refetch) would keep the star stuck on the refused value. Only a
      // successful toggle writes the settled truth; a detail refetch that
      // started after onMutate's cancel can still read the pre-commit row
      // and flip the star back, so the success path cancels it first.
      if (error) {
        if (!isStalePageMutation(page.id, 'favorite', seq)) {
          void queryClient.invalidateQueries({ queryKey: ['pages', 'favorites'] })
        }
        return
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.pages.detail(page.id) })
      // A newer favorite owns the star. An update of the same page does not:
      // this toggle still has to write is_favorite after that update stores
      // the server page.
      if (isStalePageMutation(page.id, 'favorite', seq)) return
      queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(page.id), old =>
        old ? { ...old, is_favorite: favorite } : old
      )
      void queryClient.invalidateQueries({ queryKey: ['pages', 'favorites'] })
    },
  })
  return {
    mutateAsync: (variables: { page: PageSummary; favorite: boolean }) =>
      runPageMutation(variables.page.id, 'favorite', (wait, seq) =>
        mutation.mutateAsync({ ...variables, wait, seq })
      ),
  }
}
