import type {
  DatabaseProperty,
  DatabaseView,
  DateValue,
  OptionColor,
  PropertyType,
  PropertyValue,
  RowProperties,
  SelectOption,
  ViewType,
} from '@/types/database'
import type { PageResponse } from '@/types/page'

/** The part of a page the database views need. Public pages have fewer fields than app pages. */
export type RowLike = Pick<PageResponse, 'id' | 'title' | 'icon' | 'properties'> &
  Partial<Pick<PageResponse, 'created_at' | 'last_edited_at' | 'cover'>>

export interface PropertyTypeInfo {
  type: PropertyType
  label: string
}

/** Property types a user can add (the title exists already and is the only one of its kind). */
export const ADDABLE_TYPES: PropertyTypeInfo[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Select' },
  { type: 'multi_select', label: 'Multi-select' },
  { type: 'date', label: 'Date' },
  { type: 'person', label: 'Person' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
  { type: 'created_time', label: 'Created time' },
  { type: 'last_edited_time', label: 'Last edited time' },
]

export function typeLabel(type: PropertyType): string {
  if (type === 'title') return 'Title'
  return ADDABLE_TYPES.find(item => item.type === type)?.label ?? type
}

export const VIEW_TYPES: { type: ViewType; label: string }[] = [
  { type: 'table', label: 'Table' },
  { type: 'board', label: 'Board' },
  { type: 'list', label: 'List' },
  { type: 'gallery', label: 'Gallery' },
]

export function viewTypeLabel(type: ViewType): string {
  return VIEW_TYPES.find(item => item.type === type)?.label ?? type
}

/** Option colors a select can use, in Notion's picker order. */
export const OPTION_COLORS: OptionColor[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]

export const FALLBACK_VIEW: DatabaseView = {
  id: 'default',
  name: 'Table',
  type: 'table',
  sorts: [],
  filters: [],
  hidden_properties: [],
}

export function viewsOf(views: DatabaseView[] | null | undefined): DatabaseView[] {
  return views && views.length > 0 ? views : [FALLBACK_VIEW]
}

export function schemaOf(schema: DatabaseProperty[] | null | undefined): DatabaseProperty[] {
  return schema && schema.length > 0 ? schema : [{ id: 'title', name: 'Name', type: 'title' }]
}

export function withValue(row: RowLike, propertyId: string, value: PropertyValue): RowProperties {
  const next: RowProperties = { ...(row.properties ?? {}) }
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  ) {
    delete next[propertyId]
  } else {
    next[propertyId] = value
  }
  return next
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

/** A property for a new column: "Text", "Text 2", … so names stay unique. */
export function createProperty(type: PropertyType, existing: DatabaseProperty[]): DatabaseProperty {
  const base = typeLabel(type)
  let name = base
  for (let n = 2; existing.some(property => property.name === name); n++) name = `${base} ${n}`
  const property: DatabaseProperty = { id: newId(), name, type }
  if (type === 'select' || type === 'multi_select') property.options = []
  return property
}

export function createOption(name: string, existing: SelectOption[]): SelectOption {
  // Cycle through the colors so neighbours differ, like Notion.
  const color = OPTION_COLORS[(existing.length % (OPTION_COLORS.length - 1)) + 1]
  return { id: newId(), name, color }
}

export function isComputedType(type: PropertyType): boolean {
  return type === 'created_time' || type === 'last_edited_time'
}

// ---- reading and writing values ----

export function toText(value: PropertyValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.join(', ')
  return value.start
}

export function toNumber(value: PropertyValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function toBool(value: PropertyValue): boolean {
  return value === true
}

/** Option ids (select: one, multi-select: many) or user ids (person). */
export function toIds(value: PropertyValue): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string' && value) return [value]
  return []
}

export function toDate(value: PropertyValue): DateValue | null {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'start' in value &&
    value.start
  ) {
    return value
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return { start: value }
  return null
}

/** The value of one property of a row, with the computed ones taken from the page itself. */
export function readValue(row: RowLike, property: DatabaseProperty): PropertyValue {
  switch (property.type) {
    case 'title':
      return row.title
    case 'created_time':
      return row.created_at
    case 'last_edited_time':
      return row.last_edited_at
    default:
      return row.properties?.[property.id]
  }
}

/** True when the property shows nothing for the row. */
export function isEmptyValue(property: DatabaseProperty, value: PropertyValue): boolean {
  switch (property.type) {
    case 'checkbox':
      return !toBool(value)
    case 'select':
    case 'multi_select':
    case 'person':
      return toIds(value).length === 0
    case 'date':
      return toDate(value) === null
    case 'number':
      return toNumber(value) === null
    default:
      return toText(value).trim() === ''
  }
}

export function optionsOf(property: DatabaseProperty): SelectOption[] {
  return property.options ?? []
}

export function findOption(property: DatabaseProperty, id: string): SelectOption | undefined {
  return optionsOf(property).find(option => option.id === id)
}

/** "Oct 16, 2026", or "Oct 16 → Oct 20, 2026" for a range. */
export function formatDateValue(value: DateValue): string {
  const format = (iso: string) => {
    const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return value.end ? `${format(value.start)} → ${format(value.end)}` : format(value.start)
}

// ---- views ----

export function createView(
  type: ViewType,
  existing: DatabaseView[],
  schema: DatabaseProperty[]
): DatabaseView {
  const base = viewTypeLabel(type)
  let name = base
  for (let n = 2; existing.some(view => view.name === name); n++) name = `${base} ${n}`
  const view: DatabaseView = {
    id: newId(),
    name,
    type,
    sorts: [],
    filters: [],
    hidden_properties: [],
  }
  if (type === 'board') view.group_by = firstSelect(schema)?.id ?? null
  return view
}

export function firstSelect(schema: DatabaseProperty[]): DatabaseProperty | undefined {
  return schema.find(property => property.type === 'select')
}

/** The select property a board groups by: the view's choice, else the first select. */
export function groupProperty(
  view: DatabaseView,
  schema: DatabaseProperty[]
): DatabaseProperty | undefined {
  const chosen = schema.find(
    property => property.id === view.group_by && property.type === 'select'
  )
  return chosen ?? firstSelect(schema)
}

/** Properties the view shows, in schema order (the title always shows). */
export function visibleProperties(
  view: DatabaseView,
  schema: DatabaseProperty[]
): DatabaseProperty[] {
  return schema.filter(
    property => property.type === 'title' || !view.hidden_properties.includes(property.id)
  )
}

/** Removes every mention of a property from the views (after the property is deleted). */
export function withoutProperty(views: DatabaseView[], propertyId: string): DatabaseView[] {
  return views.map(view => ({
    ...view,
    group_by: view.group_by === propertyId ? null : view.group_by,
    sorts: view.sorts.filter(sort => sort.property_id !== propertyId),
    filters: view.filters.filter(filter => filter.property_id !== propertyId),
    hidden_properties: view.hidden_properties.filter(id => id !== propertyId),
  }))
}
