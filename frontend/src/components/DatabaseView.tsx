import type { PageResponse } from '@/types/page'

export function DatabaseView({ page }: { page: PageResponse; editable: boolean }) {
  return <div className="px-24 py-8">Database {page.id}</div>
}
