import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { PageIcon } from '@/components/PageIcon'
import { pageLabel } from '@/features/pages/page-tree'
import type { PageResponse } from '@/types/page'

/** Parents (links) and the current page, with icons, truncated like Notion's. */
export function Breadcrumbs({ page }: { page: PageResponse }) {
  const crumbs = page.breadcrumbs
  // With a deep tree, keep the first and the last two parents.
  const hidden = crumbs.length > 3 ? crumbs.slice(1, crumbs.length - 2) : []
  const visible = hidden.length > 0 ? [crumbs[0], ...crumbs.slice(-2)] : crumbs

  return (
    <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center text-[14px]">
      {visible.map((crumb, index) => (
        <span key={crumb.id} className="flex min-w-0 shrink items-center">
          <Link
            to="/p/$pageId"
            params={{ pageId: crumb.id }}
            className="text-muted-foreground hover:bg-hover flex min-w-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 transition-colors duration-100"
          >
            <PageIcon icon={crumb.icon} size={18} className="shrink-0" />
            <span className="max-w-[140px] truncate">{pageLabel(crumb)}</span>
          </Link>
          <ChevronRight aria-hidden="true" className="text-subtle size-3.5 shrink-0" />
          {index === 0 && hidden.length > 0 && (
            <span
              className="flex items-center"
              title={hidden.map(item => pageLabel(item)).join(' / ')}
            >
              <span className="text-muted-foreground px-1">…</span>
              <ChevronRight aria-hidden="true" className="text-subtle size-3.5 shrink-0" />
            </span>
          )}
        </span>
      ))}
      <span
        aria-current="page"
        className="flex min-w-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-medium"
      >
        <PageIcon icon={page.icon} kind={page.kind} size={18} className="shrink-0" />
        <span className="max-w-[220px] truncate" data-testid="breadcrumb-current">
          {pageLabel(page)}
        </span>
      </span>
    </nav>
  )
}
