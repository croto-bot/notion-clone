import type { QueryClient } from '@tanstack/react-query'
import type { RowProperties } from '@/types/database'
import type { PageResponse, PageSummary, UpdatePageData } from '@/types/page'
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
  // The server's merged properties are the truth for every rows cache holding
  // this row (another member's key may have landed in the same merge).
  queryClient.setQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] }, rows =>
    rows?.map(row => (row.id === page.id ? { ...row, properties: page.properties } : row))
  )
}

/** Merges a per-key property patch into a row's stored properties (`null` removes the key). */
function mergeProperties(base: RowProperties | undefined, patch: RowProperties): RowProperties {
  const next: RowProperties = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

/** Shows a change of row values, schema or views before the server answers (properties merge per key). */
export function patchPageContent(
  queryClient: QueryClient,
  id: string,
  data: Pick<UpdatePageData, 'properties' | 'database_schema' | 'database_views'>
) {
  if (data.properties !== undefined) {
    const properties = data.properties
    queryClient.setQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] }, rows =>
      rows?.map(row =>
        row.id === id ? { ...row, properties: mergeProperties(row.properties, properties) } : row
      )
    )
    queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(id), old =>
      old ? { ...old, properties: mergeProperties(old.properties, properties) } : old
    )
    return
  }
  const content: Partial<PageResponse> = {}
  if (data.database_schema !== undefined) content.database_schema = data.database_schema
  if (data.database_views !== undefined) content.database_views = data.database_views
  if (Object.keys(content).length > 0) {
    queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(id), old =>
      old ? { ...old, ...content } : old
    )
  }
}
