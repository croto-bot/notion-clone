import { useEffect, useRef, useState } from 'react'
import { ListFilter, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDatabase } from '@/contexts/DatabaseContext'
import { defaultFilter, opInfo, opsFor } from '@/features/database/filter-sort'
import { displayNameOf } from '@/hooks/useUser'
import { cn } from '@/lib/utils'
import type { DatabaseProperty, FilterOp, ViewFilter } from '@/types/database'

export const selectClass =
  'bg-input h-7 min-w-0 rounded-[4px] px-1.5 text-[13px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57)]'

/** A text input that sends its value after a pause in typing (and on Enter or blur). */
function DebouncedInput({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange'
>) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(onCommit)
  useEffect(() => {
    latest.current = onCommit
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <input
      {...props}
      value={draft}
      onChange={event => {
        setDraft(event.target.value)
        clearTimeout(timer.current)
        const next = event.target.value
        timer.current = setTimeout(() => latest.current(next), 300)
      }}
      onBlur={() => {
        clearTimeout(timer.current)
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          clearTimeout(timer.current)
          onCommit(draft)
        }
        event.stopPropagation()
      }}
      className={cn(selectClass, 'w-full', props.className)}
    />
  )
}

function ValueInput({
  property,
  filter,
  onChange,
}: {
  property: DatabaseProperty
  filter: ViewFilter
  onChange: (value: string) => void
}) {
  const { members, editable } = useDatabase()
  const info = opInfo(property.type, filter.op)
  if (!info?.needsValue) return null
  const value =
    typeof filter.value === 'string' || typeof filter.value === 'number' ? String(filter.value) : ''

  if (property.type === 'select' || property.type === 'multi_select') {
    return (
      <select
        aria-label="Filter value"
        value={value}
        disabled={!editable}
        onChange={event => onChange(event.target.value)}
        className={cn(selectClass, 'w-full')}
      >
        <option value="">Choose an option</option>
        {(property.options ?? []).map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    )
  }
  if (property.type === 'person') {
    return (
      <select
        aria-label="Filter value"
        value={value}
        disabled={!editable}
        onChange={event => onChange(event.target.value)}
        className={cn(selectClass, 'w-full')}
      >
        <option value="">Choose a person</option>
        {members.map(member => (
          <option key={member.user_id} value={member.user_id}>
            {displayNameOf(member)}
          </option>
        ))}
      </select>
    )
  }
  if (
    property.type === 'date' ||
    property.type === 'created_time' ||
    property.type === 'last_edited_time'
  ) {
    return (
      <input
        type="date"
        aria-label="Filter value"
        value={value.slice(0, 10)}
        disabled={!editable}
        onChange={event => onChange(event.target.value)}
        className={cn(selectClass, 'w-full')}
      />
    )
  }
  return (
    <DebouncedInput
      aria-label="Filter value"
      placeholder="Type a value…"
      type={property.type === 'number' ? 'number' : 'text'}
      value={value}
      disabled={!editable}
      readOnly={!editable}
      onCommit={onChange}
    />
  )
}

/** The "Filter" button: rules of the view (property, operator, value) that hide the other rows. */
export function FilterPopover() {
  const { schema, view, updateView, editable } = useDatabase()
  const filters = view.filters
  const setFilters = (next: ViewFilter[]) => updateView({ ...view, filters: next })

  const add = () => {
    const first = schema[0]
    if (first) setFilters([...filters, defaultFilter(first)])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={filters.length ? `Filter, ${filters.length} active` : 'Filter'}
          className={cn(
            'hover:bg-hover data-[state=open]:bg-hover-strong flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[14px] transition-colors duration-75',
            filters.length > 0 ? 'text-primary font-medium' : 'text-muted-foreground'
          )}
        >
          <ListFilter className="size-4" />
          Filter
          {filters.length > 0 && <span className="text-[12px]">{filters.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-2">
        {filters.length === 0 && (
          <p className="text-muted-foreground px-1 py-1.5 text-[13px]">
            No filters yet. Rows that pass every filter stay in the view.
          </p>
        )}
        <ul aria-label="Filters" className="space-y-1.5">
          {filters.map((filter, index) => {
            const property = schema.find(item => item.id === filter.property_id)
            if (!property) return null
            return (
              <li key={index} className="flex items-center gap-1.5" data-testid="filter-rule">
                <select
                  aria-label="Filter property"
                  value={property.id}
                  disabled={!editable}
                  onChange={event => {
                    const next = schema.find(item => item.id === event.target.value)
                    if (next)
                      setFilters(
                        filters.map((item, i) => (i === index ? defaultFilter(next) : item))
                      )
                  }}
                  className={cn(selectClass, 'w-[110px] shrink-0')}
                >
                  {schema.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter operator"
                  value={filter.op}
                  disabled={!editable}
                  onChange={event => {
                    const op = event.target.value as FilterOp
                    const needsValue = opInfo(property.type, op)?.needsValue
                    setFilters(
                      filters.map((item, i) =>
                        i === index
                          ? { ...item, op, value: needsValue ? (item.value ?? '') : null }
                          : item
                      )
                    )
                  }}
                  className={cn(selectClass, 'w-[120px] shrink-0')}
                >
                  {opsFor(property.type).map(info => (
                    <option key={info.op} value={info.op}>
                      {info.label}
                    </option>
                  ))}
                </select>
                <div className="min-w-0 flex-1">
                  <ValueInput
                    property={property}
                    filter={filter}
                    onChange={value =>
                      setFilters(
                        filters.map((item, i) => (i === index ? { ...item, value } : item))
                      )
                    }
                  />
                </div>
                {editable && (
                  <button
                    type="button"
                    aria-label="Remove filter"
                    onClick={() => setFilters(filters.filter((_, i) => i !== index))}
                    className="text-muted-foreground hover:bg-hover grid size-7 shrink-0 place-items-center rounded-[4px]"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {editable && (
          <button
            type="button"
            onClick={add}
            className="text-muted-foreground hover:bg-hover mt-1.5 flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[14px]"
          >
            <Plus className="size-4" />
            Add a filter
          </button>
        )}
        {editable && filters.length > 0 && (
          <button
            type="button"
            onClick={() => setFilters([])}
            className="text-destructive hover:bg-hover mt-0.5 flex h-7 items-center rounded-[4px] px-2 text-[14px]"
          >
            Delete filter
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
