import { pageColumnClass } from '@/components/PageHeader'
import { DatabaseFrame } from '@/components/DatabaseFrame'
import { useDatabaseMutations } from '@/hooks/useDatabase'
import { useMembers } from '@/hooks/useWorkspaces'
import { usePageRows } from '@/hooks/usePages'
import { schemaOf } from '@/features/database/properties'
import { getErrorMessage } from '@/lib/error-handler'
import { cn } from '@/lib/utils'
import type { PageResponse } from '@/types/page'

function DatabaseSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="mb-2 h-7 w-24 rounded-[4px] bg-hover" />
      <div className="h-[33px] w-full bg-hover" />
      <div className="mt-px h-[33px] w-full bg-hover" />
      <div className="mt-px h-[33px] w-full bg-hover" />
      <div className="mt-px h-[33px] w-2/3 bg-hover" />
    </div>
  )
}

export function DatabaseView({ page, editable }: { page: PageResponse; editable: boolean }) {
  const { data: rows, isPending, isError, error } = usePageRows(page.id)
  const { data: members = [] } = useMembers(page.workspace_id)
  const mutations = useDatabaseMutations(page.id)
  const schema = schemaOf(page.database_schema)

  return (
    <div className={cn(pageColumnClass(page), 'pt-1')}>
      {isPending ? (
        <DatabaseSkeleton />
      ) : isError ? (
        <p className="text-muted-foreground py-6 text-[14px]">
          {getErrorMessage(error, 'Could not load this database.')}
        </p>
      ) : (
        <DatabaseFrame
          key={page.id}
          databaseId={page.id}
          editable={editable}
          isPublic={false}
          schema={schema}
          storedViews={page.database_views ?? []}
          allRows={rows ?? []}
          members={members}
          onSaveSchema={mutations.saveSchema}
          onSaveViews={mutations.saveViews}
          onSetRowValue={mutations.setRowValue}
          onCreateRow={mutations.createRow}
          onOpenRow={mutations.openRow}
        />
      )}
    </div>
  )
}
