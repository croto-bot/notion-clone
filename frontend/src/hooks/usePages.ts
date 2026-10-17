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
  rowsKeyOf,
  storePageResponse,
} from '@/features/pages/page-cache'
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

/** Updates to one page take turns: a queued update's PATCH waits for the
 * previous update of that page to settle completely, so their requests and
 * cache writes never interleave. The optimistic patch is not part of the turn
 * (onMutate runs at call time): a slow first PATCH must not hold back the
 * newer edit's paint. */
const pageMutationTails = new Map<string, Promise<unknown>>()
const pageMutationCounts = new Map<string, number>()

const settledOf = (promise: Promise<unknown>) => promise.catch(() => undefined)

/** True when an update of this page was called after this one: its paint is
 * already on the caches, so this mutation's settle handlers must not write
 * over it. Predecessors have fully settled (the PATCH waited for them), so
 * more than one pending update always means a newer one. */
function hasNewerPageMutation(pageId: string): boolean {
  return (pageMutationCounts.get(pageId) ?? 0) > 1
}

/** Runs one update mutation of a page: the optimistic patch applies now, the
 * request inside mutationFn waits for the previous update's full settle. */
function runPageMutation<TData, TVariables extends { id: string }>(
  mutation: { mutateAsync: (variables: TVariables & { wait: Promise<unknown> }) => Promise<TData> },
  variables: TVariables
): Promise<TData> {
  const id = variables.id
  pageMutationCounts.set(id, (pageMutationCounts.get(id) ?? 0) + 1)
  const done = mutation.mutateAsync({
    ...variables,
    wait: settledOf(pageMutationTails.get(id) ?? Promise.resolve()),
  })
  const tail = settledOf(done)
  pageMutationTails.set(id, tail)
  void tail.then(() => {
    if (pageMutationTails.get(id) === tail) pageMutationTails.delete(id)
    const left = (pageMutationCounts.get(id) ?? 1) - 1
    if (left <= 0) pageMutationCounts.delete(id)
    else pageMutationCounts.set(id, left)
  })
  return done
}

export function useUpdatePage() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({
      id,
      data,
      wait,
    }: { id: string; data: UpdatePageData } & { wait: Promise<unknown> }) =>
      wait.then(() => api.patch<PageResponse>(API.PAGES.DETAIL(id), data)),
    onMutate: async ({ id, data }) => {
      // Cancel in-flight reads first: a fetch that started before the change
      // would resolve after the optimistic patch and clobber it (a filter or
      // favorite that visibly "jumps back"). The page lists are cancelled for
      // the same reason: the repair refetch of an older update or an events
      // flush would land its older title over the patch.
      await cancelPageReads(queryClient, id)
      await cancelPageLists(queryClient)
      patchPageContent(queryClient, id, data)
      const patch: Parameters<typeof patchPageEverywhere>[2] = {}
      if (data.title !== undefined) patch.title = data.title
      if (data.icon !== undefined) patch.icon = data.icon
      if (data.is_public !== undefined) patch.is_public = data.is_public
      if (Object.keys(patch).length > 0) patchPageEverywhere(queryClient, id, patch)
    },
    onSuccess: async (page, { id }) => {
      // A read of this page that started before the server committed can
      // still be in flight (an events-driven invalidation raced the request);
      // its response would land right after this store and revert it. That is
      // the race that made the "Delete view" menu vanish mid-click: the views
      // list reverted, the popover's view unmounted under the pointer.
      await cancelPageReads(queryClient, id)
      // A newer update was called while this one was in flight: its paint is
      // on the caches and its own settle writes the truth. Storing this older
      // response would revert that paint, so this mutation writes nothing.
      if (hasNewerPageMutation(id)) return
      storePageResponse(queryClient, page)
      // A row PATCH does not paint the server's merged properties into the
      // rows caches: the rows list refetches instead (the row it renders
      // carries more than properties, and another member's key may be in the
      // same merge).
      invalidateRowsOf(queryClient, id, page.parent_id)
    },
    onError: (_error, { id }) => {
      // The optimistic patch must not linger: the detail, the rows and every
      // page list refetch the server's truth. When a newer update was called,
      // its paint is live and its own handlers repair the caches; repairing
      // here would refetch the older truth over that paint.
      if (hasNewerPageMutation(id)) return
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) })
      invalidateRowsOf(queryClient, id)
      invalidatePageLists(queryClient)
    },
  })
  const mutateAsync = (variables: { id: string; data: UpdatePageData }) =>
    runPageMutation(mutation, variables)
  return { ...mutation, mutateAsync }
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

export function useSetFavorite() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({
      page,
      favorite,
      wait,
    }: { page: PageSummary; favorite: boolean } & { wait: Promise<unknown> }) =>
      wait.then(() =>
        favorite
          ? api.put<void>(API.PAGES.FAVORITE(page.id), {})
          : api.delete(API.PAGES.FAVORITE(page.id))
      ),
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
      // A newer mutation of this page was called: its paint is live and its
      // own handlers repair the caches; restoring the older snapshot here
      // would revert that paint.
      if (hasNewerPageMutation(page.id)) return
      restoreLists(queryClient, context?.snapshot)
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id) })
    },
    onSettled: async (_data, error, { page, favorite }) => {
      // On error the optimistic star is wrong and onError has already queued
      // the repair refetch: writing `is_favorite` here (or cancelling that
      // refetch) would keep the star stuck on the refused value. Only a
      // successful toggle writes the settled truth; the events socket's
      // open-flush (or any page.* event) can still have started a detail
      // refetch after onMutate's cancel that reads the pre-commit row and
      // would flip the star back, so the success path cancels it first and
      // the next invalidation refetches normally.
      if (error) {
        void queryClient.invalidateQueries({ queryKey: ['pages', 'favorites'] })
        return
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.pages.detail(page.id) })
      // A newer mutation of this page was called (a second toggle, an edit):
      // its paint is live, and writing this toggle's settled value over it
      // would flip it back. Checked after the cancel, right before the write.
      if (hasNewerPageMutation(page.id)) return
      queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(page.id), old =>
        old ? { ...old, is_favorite: favorite } : old
      )
      void queryClient.invalidateQueries({ queryKey: ['pages', 'favorites'] })
    },
  })
  // Favorite toggles take the same per-page turns as updates: a toggle and an
  // update of one page never interleave their requests or cache writes.
  const mutateAsync = (variables: { page: PageSummary; favorite: boolean }) =>
    runPageMutation(mutation, { id: variables.page.id, ...variables })
  return { ...mutation, mutateAsync }
}
