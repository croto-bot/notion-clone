import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronRight, Database, MoreHorizontal, Plus } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageIcon } from '@/components/PageIcon'
import { PageRowMenu } from '@/components/PageRowMenu'
import { SidebarNavButton } from '@/components/SidebarNavRow'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { usePageTree } from '@/hooks/usePages'
import {
  TAIL_ID,
  ancestorIds,
  buildTree,
  flattenVisible,
  pageLabel,
  resolveDrop,
  subtreeIds,
  type DropTarget,
  type VisibleRow,
} from '@/features/pages/page-tree'
import { cn } from '@/lib/utils'
import type { PageSummary } from '@/types/page'

const ROW_HEIGHT = 28
const INDENT = 16

function readExpanded(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    )
  } catch {
    return new Set()
  }
}

/** Open parents of the sidebar, remembered per workspace. */
function useExpandedIds(workspaceId: string) {
  const key = `nx-expanded:${workspaceId}`
  const [expanded, setExpanded] = useState(() => readExpanded(key))

  const update = useCallback(
    (change: (current: Set<string>) => Set<string>) => {
      setExpanded(current => {
        const next = change(current)
        try {
          localStorage.setItem(key, JSON.stringify([...next]))
        } catch {
          // Private mode: not saved.
        }
        return next
      })
    },
    [key]
  )
  return [expanded, update] as const
}

/** Pixels from the row's left edge to its title: padding + toggle (20) + icon (20) + gap. */
const rowPadding = (depth: number) => 4 + depth * INDENT

interface TreeRowProps {
  row: VisibleRow
  active: boolean
  drop: DropTarget | null
  dragging: boolean
  canEdit: boolean
  renaming: boolean
  onToggle: (id: string) => void
  onExpand: (id: string) => void
  onRenameStart: (id: string) => void
  onRenameEnd: (id: string, title: string | null) => void
}

function TreeRow({
  row,
  active,
  drop,
  dragging,
  canEdit,
  renaming,
  onToggle,
  onExpand,
  onRenameStart,
  onRenameEnd,
}: TreeRowProps) {
  const { page } = row.node
  const hasChildren = row.node.children.length > 0
  const [menuOpen, setMenuOpen] = useState(false)
  const { createPage } = usePageActions()
  const { listeners, setNodeRef: setDragRef } = useDraggable({
    id: page.id,
    disabled: !canEdit || renaming,
  })
  const { setNodeRef: setDropRef } = useDroppable({ id: page.id })
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  const isTarget = drop?.overId === page.id
  const label = pageLabel(page)

  return (
    <div
      ref={setRef}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={hasChildren || row.expanded ? row.expanded : undefined}
      aria-selected={active}
      data-page-id={page.id}
      className={cn(
        'group/row text-muted-foreground relative flex items-center rounded-[4px] pr-1 text-[14px] font-medium transition-colors duration-100 select-none',
        active ? 'bg-hover-strong text-foreground' : 'hover:bg-hover',
        dragging && 'opacity-40',
        isTarget && drop.zone === 'inside' && 'bg-selected ring-primary/60 ring-1'
      )}
      style={{ height: ROW_HEIGHT, paddingLeft: rowPadding(row.depth) }}
      {...listeners}
    >
      <button
        type="button"
        aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${label}`}
        onClick={() => onToggle(page.id)}
        className={cn(
          'hover:bg-pressed grid size-5 shrink-0 place-items-center rounded-[3px] transition-colors duration-100',
          // Always on for a parent; other rows show it on hover (it opens "No pages inside").
          hasChildren
            ? 'opacity-100'
            : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
        )}
      >
        <ChevronRight
          className={cn(
            'text-subtle size-4 transition-transform duration-150',
            row.expanded && 'rotate-90'
          )}
        />
      </button>

      {renaming ? (
        <RenameInput page={page} onDone={title => onRenameEnd(page.id, title)} />
      ) : (
        <Link
          to="/p/$pageId"
          params={{ pageId: page.id }}
          draggable={false}
          onDragStart={event => event.preventDefault()}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PageIcon icon={page.icon} kind={page.kind} size={20} />
          <span className="truncate">{label}</span>
        </Link>
      )}

      {!renaming && (
        <div
          className={cn(
            'ml-auto items-center gap-0.5 pl-1',
            menuOpen ? 'flex' : 'hidden group-focus-within/row:flex group-hover/row:flex'
          )}
        >
          <PageRowMenu
            page={page}
            onOpenChange={setMenuOpen}
            onRename={canEdit ? () => onRenameStart(page.id) : undefined}
          >
            <button
              type="button"
              aria-label={`Options for ${label}`}
              className="hover:bg-pressed grid size-5 place-items-center rounded-[3px] transition-colors duration-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </PageRowMenu>
          {canEdit && page.kind === 'page' && (
            <Tip label="Add a page inside" side="bottom">
              <button
                type="button"
                aria-label={`Add a page inside ${label}`}
                onClick={() => {
                  onExpand(page.id)
                  void createPage({ parentId: page.id })
                }}
                className="hover:bg-pressed grid size-5 place-items-center rounded-[3px] transition-colors duration-100"
              >
                <Plus className="size-4" />
              </button>
            </Tip>
          )}
        </div>
      )}

      {isTarget && drop.zone !== 'inside' && (
        <DropLine
          position={drop.zone === 'before' ? 'top' : 'bottom'}
          depth={row.depth + (drop.zone === 'after' && row.expanded && hasChildren ? 1 : 0)}
        />
      )}
    </div>
  )
}

function DropLine({ position, depth }: { position: 'top' | 'bottom'; depth: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-primary pointer-events-none absolute right-1 z-10 h-[2px] rounded-full',
        position === 'top' ? '-top-px' : '-bottom-px'
      )}
      style={{ left: rowPadding(depth) + 20 }}
    >
      <span className="border-primary bg-background absolute -top-[3px] -left-[4px] size-2 rounded-full border-2" />
    </span>
  )
}

function RenameInput({
  page,
  onDone,
}: {
  page: PageSummary
  onDone: (title: string | null) => void
}) {
  const [value, setValue] = useState(page.title)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    onDone(save ? value : null)
  }
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's "Rename" click
      autoFocus
      aria-label="Page title"
      value={value}
      placeholder="Untitled"
      onChange={event => setValue(event.target.value)}
      onFocus={event => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === 'Enter') finish(true)
        else if (event.key === 'Escape') finish(false)
        event.stopPropagation()
      }}
      className="text-foreground mx-1 h-[22px] min-w-0 flex-1 rounded-[3px] bg-background px-1 text-[14px] shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57),0_0_0_2px_rgba(35,131,226,0.35)] outline-none"
    />
  )
}

function TailDropZone({ active }: { active: boolean }) {
  const { setNodeRef } = useDroppable({ id: TAIL_ID })
  return (
    <div ref={setNodeRef} aria-hidden="true" className="relative h-2">
      {active && (
        <span className="bg-primary pointer-events-none absolute right-1 left-6 top-0 h-[2px] rounded-full" />
      )}
    </div>
  )
}

/** Section title row: "Pages" with the hover "..." and "+" buttons. */
function SectionHeader({ canEdit }: { canEdit: boolean }) {
  const { createPage } = usePageActions()
  return (
    <div className="group/header flex h-[26px] items-center px-2">
      <span className="text-subtle text-[12px] font-medium">Pages</span>
      {canEdit && (
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-focus-within/header:opacity-100 group-hover/header:opacity-100">
          <DropdownMenu>
            <Tip label="More options" side="bottom">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Pages options"
                  className="text-muted-foreground hover:bg-hover-strong grid size-5 place-items-center rounded-[3px] data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="start" className="w-[220px]">
              <DropdownMenuItem onSelect={() => void createPage()}>
                <Plus />
                New page
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void createPage({ kind: 'database' })}>
                <Database />
                New database
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label="Add a page" side="bottom">
            <button
              type="button"
              aria-label="Add a page"
              onClick={() => void createPage()}
              className="text-muted-foreground hover:bg-hover-strong grid size-5 place-items-center rounded-[3px]"
            >
              <Plus className="size-4" />
            </button>
          </Tip>
        </div>
      )}
    </div>
  )
}

/** The "Pages" section: the nested page tree with drag and drop to reorder and nest. */
export function SidebarPageTree() {
  const { workspace, canEdit } = useWorkspace()
  const { data: pages = [], isLoading } = usePageTree(workspace.id)
  const { createPage, movePage, updatePage } = usePageActions()
  const currentPageId = useParams({ strict: false }).pageId as string | undefined

  const roots = useMemo(() => buildTree(pages), [pages])
  const [expanded, updateExpanded] = useExpandedIds(workspace.id)
  const rows = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const pointerStart = useRef<{ y: number } | null>(null)

  // Opening a page (a link, a search result, a new page) shows it in the tree.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (!currentPageId || revealed.current === currentPageId || pages.length === 0) return
    const parents = ancestorIds(pages, currentPageId)
    if (parents.length === 0 && !pages.some(page => page.id === currentPageId)) return
    revealed.current = currentPageId
    if (parents.length > 0) updateExpanded(current => new Set([...current, ...parents]))
  }, [currentPageId, pages, updateExpanded])

  const toggle = useCallback(
    (id: string) =>
      updateExpanded(current => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [updateExpanded]
  )
  const expand = useCallback(
    (id: string) => updateExpanded(current => new Set(current).add(id)),
    [updateExpanded]
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const blocked = useMemo(
    () => (draggingId ? subtreeIds(pages, draggingId) : new Set<string>()),
    [pages, draggingId]
  )

  const onDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id))
    const start = event.activatorEvent as PointerEvent
    pointerStart.current = { y: start.clientY }
  }

  const onDragMove = (event: DragMoveEvent) => {
    const over = event.over
    const start = pointerStart.current
    if (!over || !start) return setDrop(null)
    const overId = String(over.id)
    if (overId === TAIL_ID) {
      setDrop(current =>
        current?.overId === TAIL_ID ? current : { overId: TAIL_ID, zone: 'after' }
      )
      return
    }
    if (blocked.has(overId)) return setDrop(null)
    const pointerY = start.y + event.delta.y
    const ratio = (pointerY - over.rect.top) / over.rect.height
    const zone = ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside'
    setDrop(current =>
      current?.overId === overId && current.zone === zone ? current : { overId, zone }
    )
  }

  const onDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id)
    const current = drop
    setDraggingId(null)
    setDrop(null)
    pointerStart.current = null
    if (!current) return
    const target = resolveDrop(pages, dragId, current, expanded)
    if (!target) return
    if (target.parentId) expand(target.parentId)
    void movePage(dragId, target.parentId, target.afterId)
  }

  const onDragCancel = () => {
    setDraggingId(null)
    setDrop(null)
    pointerStart.current = null
  }

  // Hovering a closed parent for a moment opens it, so a page can be dropped deeper.
  useEffect(() => {
    if (!drop || drop.zone !== 'inside' || expanded.has(drop.overId)) return
    const timer = setTimeout(() => expand(drop.overId), 600)
    return () => clearTimeout(timer)
  }, [drop, expanded, expand])

  const commitRename = (id: string, title: string | null) => {
    setRenamingId(null)
    const page = pages.find(item => item.id === id)
    if (title === null || !page || title === page.title) return
    void updatePage(id, { title })
  }

  const draggedPage = draggingId ? pages.find(page => page.id === draggingId) : undefined

  return (
    <section aria-label="Pages" className="pt-2">
      <SectionHeader canEdit={canEdit} />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div role="tree" aria-label="Page tree" className="px-1">
          {isLoading && <TreeSkeleton />}
          {rows.map(row => (
            <div key={row.node.page.id}>
              <TreeRow
                row={row}
                active={row.node.page.id === currentPageId}
                drop={drop}
                dragging={draggingId === row.node.page.id}
                canEdit={canEdit}
                renaming={renamingId === row.node.page.id}
                onToggle={toggle}
                onExpand={expand}
                onRenameStart={setRenamingId}
                onRenameEnd={commitRename}
              />
              {row.expanded && row.node.children.length === 0 && (
                <div
                  className="text-subtle flex h-[28px] items-center text-[13px]"
                  style={{ paddingLeft: rowPadding(row.depth + 1) + 20 }}
                >
                  No pages inside
                </div>
              )}
            </div>
          ))}
          <TailDropZone active={drop?.overId === TAIL_ID} />
        </div>
        <DragOverlay dropAnimation={null}>
          {draggedPage ? (
            <div className="bg-popover text-foreground shadow-menu flex h-[28px] w-[200px] items-center gap-1.5 rounded-[4px] px-2 text-[14px] font-medium opacity-95">
              <PageIcon icon={draggedPage.icon} kind={draggedPage.kind} size={20} />
              <span className="truncate">{pageLabel(draggedPage)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {canEdit && (
        <div className="px-1">
          <SidebarNavButton
            icon={<Plus className="text-muted-foreground" />}
            onClick={() => void createPage()}
            className="text-subtle hover:text-muted-foreground"
          >
            New page
          </SidebarNavButton>
        </div>
      )}
    </section>
  )
}

function TreeSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-1 px-1 py-1">
      {[70, 52, 62].map(width => (
        <div key={width} className="flex h-[22px] items-center gap-2 px-1">
          <div className="bg-hover-strong size-4 rounded-[3px]" />
          <div className="bg-hover-strong h-3 rounded-[3px]" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  )
}
