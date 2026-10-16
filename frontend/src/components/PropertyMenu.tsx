import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, EyeOff, Trash2 } from 'lucide-react'
import { PropertyIcon } from '@/components/PropertyIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDatabase } from '@/contexts/DatabaseContext'
import { ADDABLE_TYPES } from '@/features/database/properties'
import { cn } from '@/lib/utils'
import type { DatabaseProperty, SortDirection } from '@/types/database'

const itemClass =
  'flex min-h-[28px] w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[14px] transition-colors duration-75 hover:bg-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

interface PropertyMenuProps {
  property: DatabaseProperty
  /** The header button that opens the menu. */
  children: React.ReactElement
}

/** The menu of a column header: rename, change type, sort, hide and delete. */
export function PropertyMenu({ property, children }: PropertyMenuProps) {
  const { editable, isPublic, view, updateView, updateProperty, deleteProperty } = useDatabase()
  const [open, setOpen] = useState(false)
  const isTitle = property.type === 'title'

  const sortBy = (direction: SortDirection) => {
    updateView({ ...view, sorts: [{ property_id: property.id, direction }] })
    setOpen(false)
  }

  if (isPublic || !editable) return children
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-1.5">
        {editable && (
          <input
            aria-label="Property name"
            defaultValue={property.name}
            onBlur={event => {
              const name = event.target.value.trim()
              if (name && name !== property.name) updateProperty({ ...property, name })
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
                setOpen(false)
              }
            }}
            className="bg-input mb-1 h-8 w-full rounded-[4px] px-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57),0_0_0_2px_rgba(35,131,226,0.35)]"
          />
        )}
        {editable && !isTitle && (
          <>
            <div className="text-subtle px-2 pt-1.5 pb-1 text-[12px] font-medium">
              Property type
            </div>
            <ul aria-label="Property type" className="max-h-[200px] overflow-y-auto">
              {ADDABLE_TYPES.map(item => (
                <li key={item.type}>
                  <button
                    type="button"
                    aria-pressed={property.type === item.type}
                    onClick={() => {
                      if (item.type !== property.type) {
                        const options =
                          item.type === 'select' || item.type === 'multi_select'
                            ? (property.options ?? [])
                            : undefined
                        updateProperty({
                          ...property,
                          type: item.type,
                          ...(options ? { options } : {}),
                        })
                      }
                      setOpen(false)
                    }}
                    className={itemClass}
                  >
                    <PropertyIcon type={item.type} />
                    <span className="flex-1">{item.label}</span>
                    {property.type === item.type && <Check />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="bg-border my-1 h-px" />
          </>
        )}
        {editable && (
          <>
            <button type="button" className={itemClass} onClick={() => sortBy('asc')}>
              <ArrowUp />
              Sort ascending
            </button>
            <button type="button" className={itemClass} onClick={() => sortBy('desc')}>
              <ArrowDown />
              Sort descending
            </button>
          </>
        )}
        {editable && !isTitle && (
          <>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                updateView({ ...view, hidden_properties: [...view.hidden_properties, property.id] })
                setOpen(false)
              }}
            >
              <EyeOff />
              Hide in view
            </button>
            <div className="bg-border my-1 h-px" />
            <button
              type="button"
              className={cn(itemClass, 'text-destructive [&_svg]:!text-destructive')}
              onClick={() => {
                deleteProperty(property.id)
                setOpen(false)
              }}
            >
              <Trash2 />
              Delete property
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
