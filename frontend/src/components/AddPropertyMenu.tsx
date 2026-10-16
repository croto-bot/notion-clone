import { useState } from 'react'
import { PropertyIcon } from '@/components/PropertyIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDatabase } from '@/contexts/DatabaseContext'
import { ADDABLE_TYPES, createProperty } from '@/features/database/properties'

/** The "+" of the table header (and of the properties popover): pick a type to add a property. */
export function AddPropertyMenu({ children }: { children: React.ReactElement }) {
  const { schema, saveSchema } = useDatabase()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-1.5">
        <div className="text-subtle px-2 pt-1 pb-1 text-[12px] font-medium">Property type</div>
        <ul aria-label="New property type" className="max-h-[300px] overflow-y-auto">
          {ADDABLE_TYPES.map(item => (
            <li key={item.type}>
              <button
                type="button"
                onClick={() => {
                  saveSchema([...schema, createProperty(item.type, schema)])
                  setOpen(false)
                }}
                className="hover:bg-hover flex min-h-[28px] w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[14px] [&_svg]:size-4 [&_svg]:text-muted-foreground"
              >
                <PropertyIcon type={item.type} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
