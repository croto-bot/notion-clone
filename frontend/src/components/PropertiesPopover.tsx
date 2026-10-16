import { Eye, EyeOff, Plus, SlidersHorizontal } from 'lucide-react'
import { AddPropertyMenu } from '@/components/AddPropertyMenu'
import { PropertyIcon } from '@/components/PropertyIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { useDatabase } from '@/contexts/DatabaseContext'

/** The "Properties" button: show or hide each property in the open view, or add a new one. */
export function PropertiesPopover() {
  const { schema, view, updateView, editable } = useDatabase()
  const hidden = new Set(view.hidden_properties)

  const toggle = (id: string) => {
    updateView({
      ...view,
      hidden_properties: hidden.has(id)
        ? view.hidden_properties.filter(item => item !== id)
        : [...view.hidden_properties, id],
    })
  }

  return (
    <Popover>
      <Tip label="Properties">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Properties"
            className="text-muted-foreground hover:bg-hover data-[state=open]:bg-hover-strong grid h-7 w-7 place-items-center rounded-[4px] transition-colors duration-75"
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-[280px] p-1.5">
        <div className="text-subtle px-2 pt-1 pb-1 text-[12px] font-medium">Shown in view</div>
        <ul aria-label="Properties" className="max-h-[320px] overflow-y-auto">
          {schema.map(property => {
            const isTitle = property.type === 'title'
            const visible = isTitle || !hidden.has(property.id)
            return (
              <li
                key={property.id}
                className="hover:bg-hover flex min-h-[30px] items-center gap-2 rounded-[4px] px-2"
              >
                <PropertyIcon
                  type={property.type}
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-[14px]">{property.name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visible}
                  aria-label={`Show ${property.name}`}
                  disabled={!editable || isTitle}
                  onClick={() => toggle(property.id)}
                  className="text-muted-foreground hover:bg-pressed grid size-6 place-items-center rounded-[4px] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              </li>
            )
          })}
        </ul>
        {editable && (
          <AddPropertyMenu>
            <button
              type="button"
              className="text-muted-foreground hover:bg-hover mt-1 flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-[14px]"
            >
              <Plus className="size-4" />
              New property
            </button>
          </AddPropertyMenu>
        )}
      </PopoverContent>
    </Popover>
  )
}
