import type { PublicPage } from '@/types/public-page'

export function PublicDatabase({ page }: { page: PublicPage }) {
  return <div>{page.rows.length} rows</div>
}
