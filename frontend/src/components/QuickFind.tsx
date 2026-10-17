import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Command as CommandPrimitive } from 'cmdk'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { PageIcon } from '@/components/PageIcon'
import { useAppShell } from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useDebounce } from '@/hooks/useDebounce'
import { useRecentPages, useSearchPages } from '@/hooks/usePages'
import { pageLabel } from '@/features/pages/page-tree'
import { formatRelative } from '@/lib/time'
import type { Breadcrumb, PageSummary } from '@/types/page'

function Crumbs({ crumbs }: { crumbs: Breadcrumb[] }) {
  if (crumbs.length === 0) return null
  return (
    <span className="text-subtle truncate text-[12px]">
      {crumbs.map(crumb => pageLabel(crumb)).join(' / ')}
    </span>
  )
}

function QuickFindPanel() {
  const { setQuickFindOpen } = useAppShell()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  // Mounted only while the dialog is open: every opening starts with an empty search.
  const [query, setQuery] = useState('')
  const q = useDebounce(query.trim(), 150)

  const searching = q.length > 0
  const recent = useRecentPages(workspace.id, 12, !searching)
  const search = useSearchPages(workspace.id, q, searching)

  const open = (page: Pick<PageSummary, 'id'>) => {
    setQuickFindOpen(false)
    void navigate({ to: '/p/$pageId', params: { pageId: page.id } })
  }

  // The query in the input is ahead of the debounced one: the list may be one request behind.
  const results = searching ? (search.data ?? []) : []
  const recents = !searching ? (recent.data ?? []) : []
  const loading = searching ? search.isFetching && !search.data : recent.isLoading

  return (
    // The server filters; cmdk only moves the highlight (arrow keys, Enter).
    // cmdk wires the input to a hidden <label> with this text (and points
    // aria-labelledby at it), so this is the input's accessible name.
    <CommandPrimitive shouldFilter={false} loop label="Search pages" className="flex flex-col">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={`Search ${workspace.name}…`}
      />
      <CommandList>
        {searching && !loading && results.length === 0 && <CommandEmpty>No results</CommandEmpty>}
        {!searching && !loading && recents.length === 0 && (
          <CommandEmpty>No recent pages yet.</CommandEmpty>
        )}
        {!searching && recents.length > 0 && (
          <CommandGroup heading="Recent">
            {recents.map(page => (
              <CommandItem key={page.id} value={page.id} onSelect={() => open(page)}>
                <PageIcon icon={page.icon} kind={page.kind} size={22} />
                <span className="truncate font-medium">{pageLabel(page)}</span>
                <span className="text-subtle ml-auto shrink-0 text-[12px]">
                  {formatRelative(page.last_edited_at)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {searching && results.length > 0 && (
          <CommandGroup heading="Best matches">
            {results.map(page => (
              <CommandItem
                key={page.id}
                value={page.id}
                onSelect={() => open(page)}
                className="items-start"
              >
                <PageIcon icon={page.icon} kind={page.kind} size={22} className="mt-px" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{pageLabel(page)}</span>
                  {page.snippet && page.snippet.trim() !== page.title.trim() && (
                    <span className="text-muted-foreground truncate text-[12px]">
                      {page.snippet}
                    </span>
                  )}
                  <Crumbs crumbs={page.breadcrumbs} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandPrimitive>
  )
}

/** Quick find (Cmd/Ctrl+K, Cmd/Ctrl+P): recent pages, or a search of titles and page text. */
export function QuickFind() {
  const { quickFindOpen, setQuickFindOpen } = useAppShell()
  return (
    <Dialog open={quickFindOpen} onOpenChange={setQuickFindOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[16%] w-[min(755px,calc(100vw-32px))] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[755px]"
      >
        <DialogTitle className="sr-only">Quick find</DialogTitle>
        <DialogDescription className="sr-only">Search pages by title or text.</DialogDescription>
        <QuickFindPanel />
      </DialogContent>
    </Dialog>
  )
}
