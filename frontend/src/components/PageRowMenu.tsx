import React from 'react'
import { Copy, CornerUpRight, Link2, Pencil, Star, StarOff, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppShell } from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { useFavorites } from '@/hooks/usePages'
import type { PageSummary } from '@/types/page'

interface PageRowMenuProps {
  page: PageSummary
  /** Called by "Rename". Left out where the row cannot be renamed in place. */
  onRename?: () => void
  onOpenChange?: (open: boolean) => void
  /** The button that opens the menu. */
  children: React.ReactElement
}

/** The "..." menu of a sidebar row: favorite, duplicate, rename, copy link, move, delete. */
export function PageRowMenu({ page, onRename, onOpenChange, children }: PageRowMenuProps) {
  const { workspace, canEdit } = useWorkspace()
  const { openMoveTo } = useAppShell()
  const { duplicatePage, deletePage, toggleFavorite, copyLink } = usePageActions()
  const { data: favorites } = useFavorites(workspace.id)
  const isFavorite = favorites?.some(item => item.id === page.id) ?? false

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="w-[240px]"
        // Closing must not move focus back onto the row: the row may be gone (delete) or renaming.
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => void toggleFavorite(page, !isFavorite)}>
          {isFavorite ? <StarOff /> : <Star />}
          {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyLink(page.id)}>
          <Link2 />
          Copy link
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuItem onSelect={() => void duplicatePage(page)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openMoveTo(page)}>
              <CornerUpRight />
              Move to
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void deletePage(page)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
