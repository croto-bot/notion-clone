import { Plus } from 'lucide-react'
import { PageIcon } from '@/components/PageIcon'
import { PropertyValueView } from '@/components/PropertyValueView'
import { useDatabase } from '@/contexts/DatabaseContext'
import { readValue, visibleProperties } from '@/features/database/properties'
import { UNTITLED } from '@/features/pages/page-tree'

export function DatabaseList() {
  const { rows, schema, view, members, editable, isPublic, openRow, createRow } = useDatabase()
  const fields = visibleProperties(view, schema).filter(property => property.type !== 'title')

  return (
    <div data-testid="database-list">
      <ul>
        {rows.map(row => {
          const label = row.title.trim() ? row.title : UNTITLED
          return (
            <li key={row.id} className="flex min-h-[36px] items-center gap-2 border-b py-1">
              <PageIcon icon={row.icon} size={20} />
              {isPublic ? (
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => openRow(row.id)}
                  className="hover:bg-hover min-w-0 flex-1 truncate rounded-[4px] px-1 py-0.5 text-left text-[14px] font-medium"
                >
                  {label}
                </button>
              )}
              <div className="hidden min-w-0 items-center gap-3 sm:flex">
                {fields.slice(0, 3).map(property => (
                  <span
                    key={property.id}
                    className="text-muted-foreground max-w-[160px] truncate text-[13px]"
                  >
                    <PropertyValueView
                      property={property}
                      value={readValue(row, property)}
                      members={members}
                    />
                  </span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      {editable && !isPublic && (
        <button
          type="button"
          aria-label="Add a row"
          onClick={() => void createRow()}
          className="text-subtle hover:bg-hover mt-1 flex h-8 items-center gap-2 rounded-[4px] px-1 text-[14px]"
        >
          <Plus className="size-4" />
          New
        </button>
      )}
    </div>
  )
}
