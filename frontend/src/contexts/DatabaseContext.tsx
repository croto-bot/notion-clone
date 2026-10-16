import { createContext, useContext } from 'react'
import type { RowLike } from '@/features/database/properties'
import type { DatabaseProperty, DatabaseView, PropertyValue } from '@/types/database'
import type { Member } from '@/types/workspace'

/** What every part of a database view (toolbar, table, board…) reads and can do. */
export interface DatabaseContextValue {
  databaseId: string
  /** False for viewers, locked databases, the trash and public pages. */
  editable: boolean
  /** True on `/share/...`: no way to open rows in the app. */
  isPublic: boolean
  schema: DatabaseProperty[]
  views: DatabaseView[]
  view: DatabaseView
  /** The rows of the open view: filtered and sorted. */
  rows: RowLike[]
  /** Every row, before the view's filters. */
  allRows: RowLike[]
  members: Member[]
  setActiveView: (viewId: string) => void
  saveSchema: (schema: DatabaseProperty[]) => void
  saveViews: (views: DatabaseView[]) => void
  /** Replaces one view (matched by id). */
  updateView: (view: DatabaseView) => void
  updateProperty: (property: DatabaseProperty) => void
  deleteProperty: (propertyId: string) => void
  setRowValue: (row: RowLike, property: DatabaseProperty, value: PropertyValue) => void
  /** Creates a row (optionally with values) and returns its id. */
  createRow: (properties?: Record<string, PropertyValue>) => Promise<string | null>
  openRow: (rowId: string) => void
}

const DatabaseContext = createContext<DatabaseContextValue | undefined>(undefined)

export const DatabaseProvider = DatabaseContext.Provider

export function useDatabase() {
  const context = useContext(DatabaseContext)
  if (context === undefined) throw new Error('useDatabase must be used within a DatabaseProvider')
  return context
}
