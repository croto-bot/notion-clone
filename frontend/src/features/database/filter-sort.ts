import type {
  DatabaseProperty,
  DatabaseView,
  FilterOp,
  PropertyType,
  ViewFilter,
  ViewSort,
} from '@/types/database'
import {
  isEmptyValue,
  optionsOf,
  readValue,
  toBool,
  toDate,
  toIds,
  toNumber,
  toText,
  type RowLike,
} from './properties'

export interface OpInfo {
  op: FilterOp
  label: string
  /** True when the operator needs a value from the user. */
  needsValue: boolean
}

const EMPTY_OPS: OpInfo[] = [
  { op: 'is_empty', label: 'Is empty', needsValue: false },
  { op: 'is_not_empty', label: 'Is not empty', needsValue: false },
]

const TEXT_OPS: OpInfo[] = [
  { op: 'contains', label: 'Contains', needsValue: true },
  { op: 'does_not_contain', label: 'Does not contain', needsValue: true },
  { op: 'is', label: 'Is', needsValue: true },
  { op: 'is_not', label: 'Is not', needsValue: true },
  { op: 'starts_with', label: 'Starts with', needsValue: true },
  { op: 'ends_with', label: 'Ends with', needsValue: true },
  ...EMPTY_OPS,
]

const NUMBER_OPS: OpInfo[] = [
  { op: 'eq', label: '=', needsValue: true },
  { op: 'neq', label: '≠', needsValue: true },
  { op: 'gt', label: '>', needsValue: true },
  { op: 'gte', label: '≥', needsValue: true },
  { op: 'lt', label: '<', needsValue: true },
  { op: 'lte', label: '≤', needsValue: true },
  ...EMPTY_OPS,
]

const SELECT_OPS: OpInfo[] = [
  { op: 'is', label: 'Is', needsValue: true },
  { op: 'is_not', label: 'Is not', needsValue: true },
  ...EMPTY_OPS,
]

const MULTI_OPS: OpInfo[] = [
  { op: 'contains', label: 'Contains', needsValue: true },
  { op: 'does_not_contain', label: 'Does not contain', needsValue: true },
  ...EMPTY_OPS,
]

const DATE_OPS: OpInfo[] = [
  { op: 'is', label: 'Is', needsValue: true },
  { op: 'before', label: 'Is before', needsValue: true },
  { op: 'after', label: 'Is after', needsValue: true },
  { op: 'on_or_before', label: 'Is on or before', needsValue: true },
  { op: 'on_or_after', label: 'Is on or after', needsValue: true },
  ...EMPTY_OPS,
]

const CHECKBOX_OPS: OpInfo[] = [
  { op: 'checked', label: 'Is checked', needsValue: false },
  { op: 'unchecked', label: 'Is not checked', needsValue: false },
]

export function opsFor(type: PropertyType): OpInfo[] {
  switch (type) {
    case 'number':
      return NUMBER_OPS
    case 'select':
      return SELECT_OPS
    case 'multi_select':
    case 'person':
      return MULTI_OPS
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return DATE_OPS
    case 'checkbox':
      return CHECKBOX_OPS
    default:
      return TEXT_OPS
  }
}

export function opInfo(type: PropertyType, op: FilterOp): OpInfo | undefined {
  return opsFor(type).find(item => item.op === op)
}

/** A new rule for a property, with the first operator of its type. */
export function defaultFilter(property: DatabaseProperty): ViewFilter {
  const [first] = opsFor(property.type)
  return { property_id: property.id, op: first.op, value: first.needsValue ? '' : null }
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

function matches(row: RowLike, property: DatabaseProperty, filter: ViewFilter): boolean {
  const value = readValue(row, property)
  const wanted = filter.value

  switch (filter.op) {
    case 'is_empty':
      return isEmptyValue(property, value)
    case 'is_not_empty':
      return !isEmptyValue(property, value)
    case 'checked':
      return toBool(value)
    case 'unchecked':
      return !toBool(value)
  }

  switch (property.type) {
    case 'number': {
      const number = toNumber(value)
      const target = toNumber(wanted as string | number | null)
      // A rule without a number yet matches everything, so a half-made rule hides nothing.
      if (target === null) return true
      if (number === null) return filter.op === 'neq'
      if (filter.op === 'eq') return number === target
      if (filter.op === 'neq') return number !== target
      if (filter.op === 'gt') return number > target
      if (filter.op === 'gte') return number >= target
      if (filter.op === 'lt') return number < target
      return number <= target
    }
    case 'select':
    case 'multi_select':
    case 'person': {
      const ids = toIds(value)
      const target = typeof wanted === 'string' ? wanted : ''
      if (!target) return true
      if (filter.op === 'is' || filter.op === 'contains') return ids.includes(target)
      return !ids.includes(target)
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const target = typeof wanted === 'string' ? wanted : ''
      if (!target) return true
      const date =
        property.type === 'date'
          ? toDate(value)?.start
          : typeof value === 'string'
            ? value
            : undefined
      if (!date) return false
      const [a, b] = [day(date), day(target)]
      if (filter.op === 'is') return a === b
      if (filter.op === 'before') return a < b
      if (filter.op === 'after') return a > b
      if (filter.op === 'on_or_before') return a <= b
      return a >= b
    }
    default: {
      const text = toText(value).toLowerCase()
      const target = (typeof wanted === 'string' ? wanted : String(wanted ?? '')).toLowerCase()
      if (!target) return true
      if (filter.op === 'contains') return text.includes(target)
      if (filter.op === 'does_not_contain') return !text.includes(target)
      if (filter.op === 'is') return text === target
      if (filter.op === 'is_not') return text !== target
      if (filter.op === 'starts_with') return text.startsWith(target)
      return text.endsWith(target)
    }
  }
}

/** Rows that pass every filter of the view. Rules of deleted properties are ignored. */
export function filterRows<T extends RowLike>(
  rows: T[],
  schema: DatabaseProperty[],
  filters: ViewFilter[]
): T[] {
  const rules = filters.flatMap(filter => {
    const property = schema.find(item => item.id === filter.property_id)
    return property ? [{ filter, property }] : []
  })
  if (rules.length === 0) return rows
  return rows.filter(row => rules.every(({ filter, property }) => matches(row, property, filter)))
}

function sortKey(row: RowLike, property: DatabaseProperty): number | string | null {
  const value = readValue(row, property)
  if (isEmptyValue(property, value)) return null
  switch (property.type) {
    case 'number':
      return toNumber(value)
    case 'checkbox':
      return toBool(value) ? 1 : 0
    case 'select': {
      const [id] = toIds(value)
      const index = optionsOf(property).findIndex(option => option.id === id)
      return index === -1 ? null : index
    }
    case 'multi_select': {
      const [id] = toIds(value)
      const index = optionsOf(property).findIndex(option => option.id === id)
      return index === -1 ? null : index
    }
    case 'date':
      return toDate(value)?.start ?? null
    case 'created_time':
    case 'last_edited_time':
      return typeof value === 'string' ? value : null
    case 'person':
      return toIds(value)[0] ?? null
    default:
      return toText(value).toLowerCase()
  }
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Stable sort by each rule in turn. Empty values go last, in both directions. */
export function sortRows<T extends RowLike>(
  rows: T[],
  schema: DatabaseProperty[],
  sorts: ViewSort[]
): T[] {
  const rules = sorts.flatMap(sort => {
    const property = schema.find(item => item.id === sort.property_id)
    return property ? [{ sort, property }] : []
  })
  if (rules.length === 0) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const { sort, property } of rules) {
        const a = sortKey(left.row, property)
        const b = sortKey(right.row, property)
        if (a === null && b === null) continue
        if (a === null) return 1
        if (b === null) return -1
        const result = compare(a, b)
        if (result !== 0) return sort.direction === 'desc' ? -result : result
      }
      return left.index - right.index
    })
    .map(item => item.row)
}

/** What a view shows: its filters, then its sorts. */
export function applyView<T extends RowLike>(
  rows: T[],
  schema: DatabaseProperty[],
  view: DatabaseView
): T[] {
  return sortRows(filterRows(rows, schema, view.filters), schema, view.sorts)
}
