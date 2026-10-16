import type { QueryClient } from '@tanstack/react-query'
import type { PageResponse, PageSummary } from '@/types/page'
import { queryKeys } from '@/lib/query-keys'

/** Prefixes of every query that lists page summaries. */
const LIST_KEYS = [
  ['pages', 'tree'],
  ['pages', 'favorites'],
  ['pages', 'recent'],
  ['pages', 'trash'],
  ['pages', 'search'],
] as const

type SummaryPatch = Partial<
  Pick<PageSummary, 'title' | 'icon' | 'is_public' | 'updated_at' | 'last_edited_at'>
>

/** Shows a change of title, icon or publish state everywhere a page is listed, before the server answers. */
export function patchPageEverywhere(queryClient: QueryClient, id: string, patch: SummaryPatch) {
  const apply = <T extends PageSummary>(list: T[] | undefined) =>
    list?.map(page => (page.id === id ? { ...page, ...patch } : page))
  for (const key of LIST_KEYS) queryClient.setQueriesData<PageSummary[]>({ queryKey: key }, apply)
  queryClient.setQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] }, apply)
  queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(id), old =>
    old ? { ...old, ...patch } : old
  )
}

/** Marks every page list stale: the next render (or the active one) reloads it. */
export function invalidatePageLists(queryClient: QueryClient) {
  for (const key of [...LIST_KEYS, ['pages', 'rows']] as const) {
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

/** Replaces the cached detail of a page with a fresh server response, and updates the lists to match. */
export function storePageResponse(queryClient: QueryClient, page: PageResponse) {
  queryClient.setQueryData(queryKeys.pages.detail(page.id), page)
  patchPageEverywhere(queryClient, page.id, {
    title: page.title,
    icon: page.icon,
    is_public: page.is_public,
    updated_at: page.updated_at,
    last_edited_at: page.last_edited_at,
  })
}
