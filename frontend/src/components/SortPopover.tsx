import { useRef } from 'react'
import { ArrowUpDown, Plus, X } from 'lucide-react'
import { selectClass } from '@/components/FilterPopover'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDatabase } from '@/contexts/DatabaseContext'
import { cn } from '@/lib/utils'
import type { SortDirection, ViewSort } from '@/types/database'

/** The "Sort" button: sort rules of the view; the first rule wins, the next ones break ties. */
export function SortPopover() {
  const { schema, view, updateView, editable } = useDatabase()
  const sorts = view.sorts
  // The popover's selects change in quick succession and each change closes
  // over this state, so keep the latest view in a ref: a slow render between
  // two changes must not drop the first one.
  const viewRef = useRef(view)
  const setSorts = (next: ViewSort[]) => {
    viewRef.current = { ...viewRef.current, sorts: next }
    updateView(viewRef.current)
  }

  const add = () => {
    const used = new Set(viewRef.current.sorts.map(sort => sort.property_id))
    const property = schema.find(item => !used.has(item.id)) ?? schema[0]
    if (property)
      setSorts([...viewRef.current.sorts, { property_id: property.id, direction: 'asc' }])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={sorts.length ? `Sort, ${sorts.length} active` : 'Sort'}
          className={cn(
            'hover:bg-hover data-[state=open]:bg-hover-strong flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[14px] transition-colors duration-75',
            sorts.length > 0 ? 'text-primary font-medium' : 'text-muted-foreground'
          )}
        >
          <ArrowUpDown className="size-4" />
          Sort
          {sorts.length > 0 && <span className="text-[12px]">{sorts.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-2">
        {sorts.length === 0 && (
          <p className="text-muted-foreground px-1 py-1.5 text-[13px]">
            No sorts yet. Rows stay in the order they were added.
          </p>
        )}
        <ul aria-label="Sorts" className="space-y-1.5">
          {sorts.map((sort, index) => (
            <li key={index} className="flex items-center gap-1.5" data-testid="sort-rule">
              <select
                aria-label="Sort property"
                value={sort.property_id}
                disabled={!editable}
                onChange={event =>
                  setSorts(
                    sorts.map((item, i) =>
                      i === index ? { ...item, property_id: event.target.value } : item
                    )
                  )
                }
                className={cn(selectClass, 'flex-1')}
              >
                {schema.map(property => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort direction"
                value={sort.direction}
                disabled={!editable}
                onChange={event =>
                  setSorts(
                    sorts.map((item, i) =>
                      i === index
                        ? { ...item, direction: event.target.value as SortDirection }
                        : item
                    )
                  )
                }
                className={cn(selectClass, 'w-[120px] shrink-0')}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              {editable && (
                <button
                  type="button"
                  aria-label="Remove sort"
                  onClick={() => setSorts(sorts.filter((_, i) => i !== index))}
                  className="text-muted-foreground hover:bg-hover grid size-7 shrink-0 place-items-center rounded-[4px]"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <button
            type="button"
            onClick={add}
            className="text-muted-foreground hover:bg-hover mt-1.5 flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[14px]"
          >
            <Plus className="size-4" />
            Add a sort
          </button>
        )}
        {editable && sorts.length > 0 && (
          <button
            type="button"
            onClick={() => setSorts([])}
            className="text-destructive hover:bg-hover mt-0.5 flex h-7 items-center rounded-[4px] px-2 text-[14px]"
          >
            Delete sort
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
