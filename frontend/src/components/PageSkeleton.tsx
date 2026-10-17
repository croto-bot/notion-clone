import { pageColumnClass } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import type { PageKind } from '@/types/page'

/**
 * Placeholder while a page loads. Laid out with the same column rule as the
 * page itself (`pageColumnClass`), so nothing shifts when the page arrives;
 * while the kind is still unknown it guesses the narrow document column.
 */
export function PageSkeleton({ page }: { page?: { full_width?: boolean; kind?: PageKind } }) {
  const column = pageColumnClass({
    full_width: page?.full_width ?? false,
    kind: page?.kind ?? 'page',
  })
  return (
    <div aria-hidden="true" className={cn(column, 'animate-pulse')}>
      <div className="h-[72px]" />
      <div className="h-[32px]" />
      <div className="bg-hover-strong h-12 w-2/3 rounded-[4px]" />
      <div className="h-3" />
      <div className="mt-2 space-y-3">
        <div className="bg-hover h-5 w-full rounded-[3px]" />
        <div className="bg-hover h-5 w-5/6 rounded-[3px]" />
        <div className="bg-hover h-5 w-2/3 rounded-[3px]" />
      </div>
    </div>
  )
}
