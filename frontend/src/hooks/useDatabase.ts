import { useCallback } from 'react'
import { usePageActions } from '@/hooks/usePageActions'
import type { RowLike } from '@/features/database/properties'
import type { DatabaseProperty, DatabaseView, PropertyValue } from '@/types/database'

export function useDatabaseMutations(databaseId: string) {
  const { updatePage, createPage, openPage } = usePageActions()

  const saveSchema = useCallback(
    (schema: DatabaseProperty[]) => {
      void updatePage(databaseId, { database_schema: schema })
    },
    [databaseId, updatePage]
  )

  const saveViews = useCallback(
    (views: DatabaseView[]) => {
      void updatePage(databaseId, { database_views: views })
    },
    [databaseId, updatePage]
  )

  const setRowValue = useCallback(
    (row: RowLike, property: DatabaseProperty, value: PropertyValue) => {
      if (property.type === 'title') {
        void updatePage(row.id, { title: typeof value === 'string' ? value : '' })
        return
      }
      // Only the changed key crosses the wire: the server merges properties
      // per key, so a stale copy of the row's other keys can never overwrite
      // what another editor saved in the meantime. null clears the key.
      const empty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      void updatePage(row.id, { properties: { [property.id]: empty ? null : value } })
    },
    [updatePage]
  )

  const createRow = useCallback(
    async (properties?: Record<string, PropertyValue>) => {
      const page = await createPage({
        parentId: databaseId,
        properties,
        stay: true,
        focusTitle: true,
      })
      return page?.id ?? null
    },
    [createPage, databaseId]
  )

  const openRow = useCallback(
    (rowId: string) => {
      void openPage(rowId)
    },
    [openPage]
  )

  return { saveSchema, saveViews, setRowValue, createRow, openRow }
}
