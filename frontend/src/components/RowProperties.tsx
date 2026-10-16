import { useState } from 'react'
import { PropertyCell } from '@/components/PropertyCell'
import { PropertyIcon } from '@/components/PropertyIcon'
import { pageColumnClass } from '@/components/PageHeader'
import { DatabaseProvider } from '@/contexts/DatabaseContext'
import { buildDatabaseContext } from '@/features/database/context-value'
import { FALLBACK_VIEW, schemaOf, viewsOf } from '@/features/database/properties'
import { useDatabaseMutations } from '@/hooks/useDatabase'
import { usePage } from '@/hooks/usePages'
import { useMembers } from '@/hooks/useWorkspaces'
import { cn } from '@/lib/utils'
import type { PageResponse } from '@/types/page'

export function RowProperties({
  page,
  databaseId,
  editable,
}: {
  page: PageResponse
  databaseId: string
  editable: boolean
}) {
  const { data: database } = usePage(databaseId)
  const { data: members = [] } = useMembers(page.workspace_id)
  const mutations = useDatabaseMutations(databaseId)
  const [activeId, setActiveId] = useState<string | null>(null)

  if (!database) {
    return (
      <div className={cn(pageColumnClass(page), 'py-2')} aria-hidden="true">
        <div className="bg-hover h-6 w-1/2 animate-pulse rounded-[4px]" />
      </div>
    )
  }

  const schema = schemaOf(database.database_schema)
  const views = viewsOf(database.database_views)
  const view = views.find(item => item.id === activeId) ?? views[0] ?? FALLBACK_VIEW
  const fields = schema.filter(property => property.type !== 'title')
  if (fields.length === 0) return null

  const value = buildDatabaseContext({
    databaseId,
    editable,
    isPublic: false,
    schema,
    views,
    view,
    rows: [page],
    allRows: [page],
    members,
    setActiveView: setActiveId,
    onSaveSchema: mutations.saveSchema,
    onSaveViews: mutations.saveViews,
    onSetRowValue: mutations.setRowValue,
    onCreateRow: mutations.createRow,
    onOpenRow: mutations.openRow,
  })

  return (
    <DatabaseProvider value={value}>
      <div data-testid="row-properties" className={cn(pageColumnClass(page), 'pt-1 pb-4')}>
        <div className="max-w-[720px] space-y-0.5">
          {fields.map(property => (
            <div key={property.id} className="grid grid-cols-[160px_minmax(0,1fr)] items-start">
              <div className="text-muted-foreground flex h-[34px] items-center gap-1.5 px-2 text-[14px]">
                <PropertyIcon type={property.type} className="size-4 shrink-0" />
                <span className="truncate">{property.name}</span>
              </div>
              <PropertyCell row={page} property={property} variant="panel" />
            </div>
          ))}
        </div>
      </div>
    </DatabaseProvider>
  )
}
