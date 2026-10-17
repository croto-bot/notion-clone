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

/** Title before the first optimistic title patch, so a refused edit can put it back.
 * Keystrokes patch the cache before the mutation snapshots it, so the mutation
 * snapshot alone would restore the refused title. */
const titleBeforeEdit = new Map<string, string>()

function readTitle(queryClient: QueryClient, id: string): string | undefined {
  const detail = queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(id))
  if (detail) return detail.title
  for (const key of LIST_KEYS) {
    for (const [, pages] of queryClient.getQueriesData<PageSummary[]>({ queryKey: key })) {
      const found = pages?.find(page => page.id === id)
      if (found) return found.title
    }
  }
  return undefined
}

function applySummary(queryClient: QueryClient, id: string, patch: SummaryPatch) {
  const apply = <T extends PageSummary>(list: T[] | undefined) =>
    list?.map(page => (page.id === id ? { ...page, ...patch } : page))
  for (const key of LIST_KEYS) queryClient.setQueriesData<PageSummary[]>({ queryKey: key }, apply)
  queryClient.setQueriesData<PageResponse[]>({ queryKey: ['pages', 'rows'] }, apply)
  queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(id), old =>
    old ? { ...old, ...patch } : old
  )
}

/** Shows a change of title, icon or publish state everywhere a page is listed, before the server answers. */
export function patchPageEverywhere(queryClient: QueryClient, id: string, patch: SummaryPatch) {
  if (patch.title !== undefined && !titleBeforeEdit.has(id)) {
    const previous = readTitle(queryClient, id)
    if (previous !== undefined && previous !== patch.title) titleBeforeEdit.set(id, previous)
  }
  applySummary(queryClient, id, patch)
}

/** Puts back the title from before the optimistic edit. No-op once the server title is stored. */
export function rollbackOptimisticTitle(queryClient: QueryClient, id: string) {
  const title = titleBeforeEdit.get(id)
  if (title === undefined) return
  titleBeforeEdit.delete(id)
  applySummary(queryClient, id, { title })
}

/** Marks every page list stale: the next render (or the active one) reloads it. */
export function invalidatePageLists(queryClient: QueryClient) {
  for (const key of [...LIST_KEYS, ['pages', 'rows']] as const) {
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

/** Cancels every page-list refetch (tree, favorites, recent, trash, search):
 * one started before an update would land its pre-change snapshot over the
 * optimistic patch (a failed older mutation's repair refetch, an events flush). */
export async function cancelPageLists(queryClient: QueryClient) {
  for (const key of LIST_KEYS) {
    await queryClient.cancelQueries({ queryKey: key })
  }
}

/** The rows query of the database that holds this row. The response knows
 * the parent; before it arrives the detail cache does (a PATCH never moves a
 * row). A page directly under the workspace root has no rows query. */
export function rowsKeyOf(
  queryClient: QueryClient,
  id: string,
  parentId?: string | null
): readonly unknown[] | undefined {
  const parent =
    parentId ?? queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(id))?.parent_id
  return parent ? queryKeys.pages.rows(parent) : undefined
}

/** Marks the rows list of a row's database stale: the refetch carries the
 * server's merged properties (another member's key may be in the same merge). */
export function invalidateRowsOf(queryClient: QueryClient, id: string, parentId?: string | null) {
  const key = rowsKeyOf(queryClient, id, parentId)
  if (key) void queryClient.invalidateQueries({ queryKey: key })
}

/** Replaces the cached detail of a page with a fresh server response, and updates the lists to match. */
export function storePageResponse(queryClient: QueryClient, page: PageResponse) {
  // The server title is the new baseline. Clear before writing so the write
  // does not record the optimistic title as the thing to roll back to.
  titleBeforeEdit.delete(page.id)
  queryClient.setQueryData(queryKeys.pages.detail(page.id), page)
  applySummary(queryClient, page.id, {
    title: page.title,
    icon: page.icon,
    is_public: page.is_public,
    updated_at: page.updated_at,
    last_edited_at: page.last_edited_at,
  })
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
