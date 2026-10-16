import { useCallback } from 'react'
import { usePageActions } from '@/hooks/usePageActions'
import { withValue, type RowLike } from '@/features/database/properties'
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
      void updatePage(row.id, { properties: withValue(row, property.id, value) })
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
