/** Property types of a database (SPEC F15). */
export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'person'
  | 'created_time'
  | 'last_edited_time'

export type OptionColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'

export interface SelectOption {
  id: string
  name: string
  /** One of `OptionColor`. The backend stores any string. */
  color: string
}

export interface DatabaseProperty {
  id: string
  name: string
  type: PropertyType
  /** Only on `select` and `multi_select`. */
  options?: SelectOption[]
}

export type ViewType = 'table' | 'board' | 'list' | 'gallery'

export type SortDirection = 'asc' | 'desc'

export interface ViewSort {
  property_id: string
  direction: SortDirection
}

/**
 * Filter operators. The backend only stores them: the filter is applied in the
 * browser (src/features/database/filter-sort.ts).
 */
export type FilterOp =
  | 'contains'
  | 'does_not_contain'
  | 'is'
  | 'is_not'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'checked'
  | 'unchecked'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'

export interface ViewFilter {
  property_id: string
  op: FilterOp
  /** A string, number or option id; missing for operators that need no value. */
  value?: string | number | boolean | null
}

export interface DatabaseView {
  id: string
  name: string
  type: ViewType
  /** Property id of the select property that groups a board. */
  group_by?: string | null
  sorts: ViewSort[]
  filters: ViewFilter[]
  hidden_properties: string[]
}

export interface DateValue {
  /** `YYYY-MM-DD`, or an ISO date-time. */
  start: string
  end?: string | null
}

/**
 * A row's value for one property, keyed by property id in `PageResponse.properties`:
 * `text`/`url` string, `number` number, `select` option id, `multi_select` option ids,
 * `date` `DateValue`, `checkbox` boolean, `person` user ids.
 * `title` is the page title, `created_time`/`last_edited_time` come from the page.
 */
export type PropertyValue = string | number | boolean | string[] | DateValue | null | undefined

export type RowProperties = Record<string, PropertyValue>
