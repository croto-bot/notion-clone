import { Plus } from 'lucide-react'
import { PageIcon } from '@/components/PageIcon'
import { PropertyValueView } from '@/components/PropertyValueView'
import { useDatabase } from '@/contexts/DatabaseContext'
import { readValue, visibleProperties } from '@/features/database/properties'
import { UNTITLED } from '@/features/pages/page-tree'
import { coverBackground } from '@/lib/colors'
import { cn } from '@/lib/utils'

export function DatabaseGallery() {
  const { rows, schema, view, members, editable, isPublic, openRow, createRow } = useDatabase()
  const fields = visibleProperties(view, schema).filter(property => property.type !== 'title')

  return (
    <div>
      <ul
        data-testid="database-gallery"
        className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
      >
        {rows.map(row => {
          const label = row.title.trim() ? row.title : UNTITLED
          const cover = row.cover
          const body = (
            <>
              <div
                className="bg-hover relative h-[120px] w-full"
                style={cover ? coverBackground(cover, 50) : undefined}
              >
                {!cover && (
                  <span className="absolute bottom-2 left-3">
                    <PageIcon icon={row.icon} size={28} />
                  </span>
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-center gap-1.5">
                  {cover && <PageIcon icon={row.icon} size={18} />}
                  <span
                    className={cn(
                      'truncate text-[14px] font-medium',
                      !row.title.trim() && 'text-subtle'
                    )}
                  >
                    {label}
                  </span>
                </div>
                {fields.slice(0, 3).map(property => (
                  <div key={property.id} className="text-muted-foreground truncate text-[12px]">
                    <PropertyValueView
                      property={property}
                      value={readValue(row, property)}
                      members={members}
                    />
                  </div>
                ))}
              </div>
            </>
          )
          return (
            <li key={row.id}>
              {isPublic ? (
                <div className="bg-background overflow-hidden rounded-[8px] shadow-[0_0_0_1px_var(--border)]">
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openRow(row.id)}
                  aria-label={`Open ${label}`}
                  className="bg-background hover:bg-hover w-full overflow-hidden rounded-[8px] text-left shadow-[0_0_0_1px_var(--border)] transition-colors duration-100"
                >
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {editable && !isPublic && (
        <button
          type="button"
          aria-label="Add a row"
          onClick={() => void createRow()}
          className="text-subtle hover:bg-hover mt-3 flex h-8 items-center gap-2 rounded-[4px] px-1 text-[14px]"
        >
          <Plus className="size-4" />
          New
        </button>
      )}
    </div>
  )
}
