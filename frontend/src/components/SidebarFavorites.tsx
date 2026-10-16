import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { PageIcon } from '@/components/PageIcon'
import { PageRowMenu } from '@/components/PageRowMenu'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useFavorites } from '@/hooks/usePages'
import { pageLabel } from '@/features/pages/page-tree'
import { cn } from '@/lib/utils'
import type { PageSummary } from '@/types/page'

function FavoriteRow({ page, active }: { page: PageSummary; active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const label = pageLabel(page)
  return (
    <div
      className={cn(
        'group/row text-muted-foreground relative flex h-[28px] items-center rounded-[4px] pr-1 pl-6 text-[14px] font-medium transition-colors duration-100',
        active ? 'bg-hover-strong text-foreground' : 'hover:bg-hover'
      )}
    >
      <Link
        to="/p/$pageId"
        params={{ pageId: page.id }}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PageIcon icon={page.icon} kind={page.kind} size={20} />
        <span className="truncate">{label}</span>
      </Link>
      <div
        className={cn(
          'ml-auto items-center pl-1',
          menuOpen ? 'flex' : 'hidden group-focus-within/row:flex group-hover/row:flex'
        )}
      >
        <PageRowMenu page={page} onOpenChange={setMenuOpen}>
          <button
            type="button"
            aria-label={`Options for ${label}`}
            className="hover:bg-pressed grid size-5 place-items-center rounded-[3px] transition-colors duration-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </PageRowMenu>
      </div>
    </div>
  )
}

/** "Favorites": my starred pages, in my order. Hidden when there are none. */
export function SidebarFavorites() {
  const { workspace } = useWorkspace()
  const { data: favorites = [] } = useFavorites(workspace.id)
  const currentPageId = useParams({ strict: false }).pageId as string | undefined

  if (favorites.length === 0) return null
  return (
    <section aria-label="Favorites" className="pt-2">
      <div className="flex h-[26px] items-center px-2">
        <span className="text-subtle text-[12px] font-medium">Favorites</span>
      </div>
      <div className="px-1">
        {favorites.map(page => (
          <FavoriteRow key={page.id} page={page} active={page.id === currentPageId} />
        ))}
      </div>
    </section>
  )
}
