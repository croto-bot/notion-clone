import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, Trash2, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { PageIcon } from '@/components/PageIcon'
import { PurgeConfirmDialog } from '@/components/PurgeConfirmDialog'
import { SidebarNavButton } from '@/components/SidebarNavRow'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { useTrash } from '@/hooks/usePages'
import { useDebounce } from '@/hooks/useDebounce'
import { pageLabel } from '@/features/pages/page-tree'
import { formatRelative } from '@/lib/time'
import type { PageSummary } from '@/types/page'

/** The sidebar's Trash row and its popover: search, restore, delete forever. */
export function TrashPopover() {
  const { workspace, canEdit } = useWorkspace()
  const navigate = useNavigate()
  const { restorePage } = usePageActions()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [toPurge, setToPurge] = useState<PageSummary | null>(null)
  const q = useDebounce(query.trim(), 200)
  const { data: pages = [], isLoading } = useTrash(workspace.id, q, open)

  return (
    <>
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <SidebarNavButton icon={<Trash2 />}>Trash</SidebarNavButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={10} className="w-[400px] p-0">
          <div className="border-b p-2">
            <div className="bg-input flex h-8 items-center gap-2 rounded-[4px] px-2 shadow-[inset_0_0_0_1px_var(--input-ring)] focus-within:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57),0_0_0_2px_rgba(35,131,226,0.35)]">
              <Search className="text-muted-foreground size-4 shrink-0" />
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover opens for searching
                autoFocus
                aria-label="Search pages in Trash"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search pages in Trash"
                className="placeholder:text-subtle h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              />
            </div>
          </div>
          <div className="nx-scroll max-h-[340px] min-h-[120px] overflow-y-auto p-1">
            {pages.length === 0 && !isLoading && (
              <div className="text-muted-foreground flex min-h-[110px] flex-col items-center justify-center gap-1 text-center">
                <Trash2 className="text-subtle size-6" strokeWidth={1.5} />
                <p className="text-[14px] font-medium">{q ? 'No results' : 'Trash is empty'}</p>
                {!q && <p className="text-subtle text-[12px]">Deleted pages show up here.</p>}
              </div>
            )}
            {pages.map(page => (
              <div
                key={page.id}
                className="group/row hover:bg-hover relative flex min-h-[40px] items-center gap-1 rounded-[4px] px-2 transition-colors duration-100"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                  onClick={() => {
                    setOpen(false)
                    void navigate({ to: '/p/$pageId', params: { pageId: page.id } })
                  }}
                >
                  <PageIcon icon={page.icon} kind={page.kind} size={20} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">
                      {pageLabel(page)}
                    </span>
                    <span className="text-subtle block truncate text-[12px]">
                      Deleted {formatRelative(page.deleted_at ?? page.updated_at)}
                    </span>
                  </span>
                </button>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Tip label="Restore">
                      <button
                        type="button"
                        aria-label={`Restore ${pageLabel(page)}`}
                        onClick={() => void restorePage(page)}
                        className="text-muted-foreground hover:bg-pressed grid size-6 place-items-center rounded-[4px]"
                      >
                        <Undo2 className="size-4" />
                      </button>
                    </Tip>
                    <Tip label="Delete permanently">
                      <button
                        type="button"
                        aria-label={`Delete ${pageLabel(page)} permanently`}
                        onClick={() => setToPurge(page)}
                        className="text-muted-foreground hover:bg-pressed grid size-6 place-items-center rounded-[4px]"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Tip>
                  </div>
                )}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <PurgeConfirmDialog page={toPurge} onClose={() => setToPurge(null)} />
    </>
  )
}
