import { withoutProperty } from '@/features/database/properties'
import type { RowLike } from '@/features/database/properties'
import type { DatabaseContextValue } from '@/contexts/DatabaseContext'
import type { DatabaseProperty, DatabaseView, PropertyValue } from '@/types/database'
import type { Member } from '@/types/workspace'

export interface DatabaseInput {
  databaseId: string
  editable: boolean
  isPublic: boolean
  schema: DatabaseProperty[]
  views: DatabaseView[]
  view: DatabaseView
  rows: RowLike[]
  allRows: RowLike[]
  members: Member[]
  setActiveView: (viewId: string) => void
  onSaveSchema: (schema: DatabaseProperty[]) => void
  onSaveViews: (views: DatabaseView[]) => void
  onSetRowValue: (row: RowLike, property: DatabaseProperty, value: PropertyValue) => void
  onCreateRow: (properties?: Record<string, PropertyValue>) => Promise<string | null>
  onOpenRow: (rowId: string) => void
}

function normalizeProperty(property: DatabaseProperty): DatabaseProperty {
  const base = { id: property.id, name: property.name, type: property.type }
  if (property.type === 'select' || property.type === 'multi_select') {
    return { ...base, options: property.options ?? [] }
  }
  return base
}

function hasValue(row: RowLike, propertyId: string): boolean {
  return !!row.properties && Object.prototype.hasOwnProperty.call(row.properties, propertyId)
}

export function buildDatabaseContext(input: DatabaseInput): DatabaseContextValue {
  const saveSchema = (schema: DatabaseProperty[]) => {
    if (input.editable) input.onSaveSchema(schema)
  }
  const saveViews = (views: DatabaseView[]) => {
    if (input.editable) input.onSaveViews(views)
  }
  const updateView = (view: DatabaseView) => {
    saveViews(input.views.map(item => (item.id === view.id ? view : item)))
  }
  const clearOnRows = (property: DatabaseProperty) => {
    for (const row of input.allRows) {
      if (hasValue(row, property.id)) input.onSetRowValue(row, property, null)
    }
  }
  const updateProperty = (property: DatabaseProperty) => {
    if (!input.editable) return
    const previous = input.schema.find(item => item.id === property.id)
    const next = normalizeProperty(property)
    saveSchema(input.schema.map(item => (item.id === next.id ? next : item)))
    if (previous && previous.type !== next.type) clearOnRows(next)
  }
  const deleteProperty = (propertyId: string) => {
    if (!input.editable) return
    const property = input.schema.find(item => item.id === propertyId)
    saveSchema(input.schema.filter(item => item.id !== propertyId))
    saveViews(withoutProperty(input.views, propertyId))
    if (property) clearOnRows(property)
  }

  return {
    databaseId: input.databaseId,
    editable: input.editable,
    isPublic: input.isPublic,
    schema: input.schema,
    views: input.views,
    view: input.view,
    rows: input.rows,
    allRows: input.allRows,
    members: input.members,
    setActiveView: input.setActiveView,
    saveSchema,
    saveViews,
    updateView,
    updateProperty,
    deleteProperty,
    setRowValue: (row, property, value) => {
      if (input.editable) input.onSetRowValue(row, property, value)
    },
    createRow: properties => {
      if (!input.editable || input.isPublic) return Promise.resolve(null)
      return input.onCreateRow(properties)
    },
    openRow: rowId => {
      if (!input.isPublic) input.onOpenRow(rowId)
    },
  }
}
