import { DatabaseFrame } from '@/components/DatabaseFrame'
import { schemaOf } from '@/features/database/properties'
import type { PublicPage } from '@/types/public-page'

const noop = () => undefined
const noopSchema = async () => null
const noopRow = async () => null

export function PublicDatabase({ page }: { page: PublicPage }) {
  return (
    <DatabaseFrame
      key={page.id}
      databaseId={page.id}
      editable={false}
      isPublic
      schema={schemaOf(page.database_schema)}
      storedViews={page.database_views ?? []}
      allRows={page.rows}
      members={[]}
      onSaveSchema={noopSchema}
      onSaveViews={noop}
      onSetRowValue={noop}
      onCreateRow={noopRow}
      onOpenRow={noop}
    />
  )
}
