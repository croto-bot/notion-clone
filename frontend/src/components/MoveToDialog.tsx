import { useMemo } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { PageIcon } from '@/components/PageIcon'
import { WorkspaceIcon } from '@/components/WorkspaceIcon'
import { useAppShell } from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { usePageTree } from '@/hooks/usePages'
import { pageLabel, subtreeIds } from '@/features/pages/page-tree'
import { SearchIcon } from 'lucide-react'

/** "Move to": pick a new parent page, or the workspace root. */
export function MoveToDialog() {
  const { moveToPage, closeMoveTo } = useAppShell()
  const { workspace } = useWorkspace()
  const { data: pages = [] } = usePageTree(workspace.id)
  const { movePage } = usePageActions()

  const candidates = useMemo(() => {
    if (!moveToPage) return []
    const blocked = subtreeIds(pages, moveToPage.id)
    return pages.filter(page => !blocked.has(page.id) && page.kind === 'page')
  }, [pages, moveToPage])

  const choose = async (parentId: string | null) => {
    if (!moveToPage) return
    closeMoveTo()
    await movePage(moveToPage.id, parentId)
  }

  return (
    <Dialog open={moveToPage !== null} onOpenChange={open => !open && closeMoveTo()}>
      <DialogContent
        showCloseButton={false}
        className="top-[22%] translate-y-0 gap-0 p-0 sm:max-w-[420px]"
      >
        <DialogTitle className="sr-only">Move to</DialogTitle>
        <DialogDescription className="sr-only">
          Choose the page this page moves into.
        </DialogDescription>
        <CommandPrimitive className="flex flex-col overflow-hidden rounded-[6px]">
          <div className="flex h-11 items-center gap-2 border-b px-3">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <CommandPrimitive.Input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens for typing the destination
              autoFocus
              placeholder="Move page to…"
              aria-label="Move page to"
              className="placeholder:text-subtle h-full w-full bg-transparent text-[14px] outline-none"
            />
          </div>
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No pages found.</CommandEmpty>
            <CommandItem value={`__root__ ${workspace.name}`} onSelect={() => void choose(null)}>
              <WorkspaceIcon name={workspace.name} icon={workspace.icon} size={20} />
              <span className="truncate">{workspace.name}</span>
              <span className="text-subtle ml-auto text-[12px]">Workspace root</span>
            </CommandItem>
            {candidates.map(page => (
              <CommandItem
                key={page.id}
                value={`${page.id} ${pageLabel(page)}`}
                onSelect={() => void choose(page.id)}
              >
                <PageIcon icon={page.icon} kind={page.kind} />
                <span className="truncate">{pageLabel(page)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}
