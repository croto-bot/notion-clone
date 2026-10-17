import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { ChevronsLeft, Home, Search, Settings, SquarePen } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { SidebarFavorites } from '@/components/SidebarFavorites'
import { SidebarNavButton, SidebarNavLink } from '@/components/SidebarNavRow'
import { SidebarPageTree } from '@/components/SidebarPageTree'
import { TrashPopover } from '@/components/TrashPopover'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useAppShell,
} from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { shortcutLabel } from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * The 4 px strip on the sidebar's right edge: drag to resize, double-click to reset.
 *
 * Always rendered; `inert` while the sidebar is collapsed, so it is never in
 * the tab order or hit-testing then. The focus outline is drawn inside the
 * strip (negative offset) because the sidebar clips overflow, in the ring's
 * base color at full strength: var(--ring) at 0.57 alpha measures ~2:1 on the
 * sidebar, under the 3:1 a focus indicator needs, while rgb(35,131,226)
 * measures 3.6:1 light and 4.5:1 dark.
 */
function ResizeHandle({ onResizing }: { onResizing: (resizing: boolean) => void }) {
  const { sidebarOpen, sidebarWidth, setSidebarWidth } = useAppShell()

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    onResizing(true)
    const onMove = (move: PointerEvent) => setSidebarWidth(startWidth + move.clientX - startX)
    const onUp = () => {
      onResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      role="slider"
      aria-orientation="horizontal"
      aria-label="Resize sidebar"
      aria-valuenow={sidebarWidth}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={sidebarOpen ? 0 : -1}
      inert={!sidebarOpen}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') setSidebarWidth(sidebarWidth - 16)
        else if (event.key === 'ArrowRight') setSidebarWidth(sidebarWidth + 16)
      }}
      className="hover:bg-primary/50 active:bg-primary/70 absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
    />
  )
}

/** The left sidebar: workspace switcher, Search / Home / Settings, favorites, page tree, Trash. */
export function Sidebar() {
  const { sidebarOpen, sidebarWidth, toggleSidebar, setQuickFindOpen, openSettings } = useAppShell()
  const { canEdit } = useWorkspace()
  const { createPage } = usePageActions()
  const [resizing, setResizing] = useState(false)
  const pathname = useRouterState({ select: state => state.location.pathname })

  return (
    <aside
      aria-label="Sidebar"
      data-testid="sidebar"
      data-open={sidebarOpen}
      className={cn(
        'bg-sidebar relative h-full shrink-0 overflow-hidden',
        resizing
          ? 'transition-none'
          : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'
      )}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div
        // A hidden sidebar must not take focus: inert removes it from the tab order.
        inert={!sidebarOpen}
        className="bg-sidebar flex h-full flex-col border-r"
        style={{ width: sidebarWidth }}
      >
        <div className="group/top flex h-[45px] shrink-0 items-center gap-0.5 px-1.5">
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher />
          </div>
          <Tip label="Close sidebar" hint={shortcutLabel('\\')} side="bottom">
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={toggleSidebar}
              className="text-muted-foreground hover:bg-hover-strong grid size-6 shrink-0 place-items-center rounded-[4px] opacity-0 transition-[opacity,background-color] duration-150 group-focus-within/top:opacity-100 group-hover/top:opacity-100"
            >
              <ChevronsLeft className="size-[18px]" />
            </button>
          </Tip>
          {canEdit && (
            <Tip label="Create a page" side="bottom">
              <button
                type="button"
                aria-label="Create a page"
                onClick={() => void createPage()}
                className="text-muted-foreground hover:bg-hover-strong grid size-6 shrink-0 place-items-center rounded-[4px] transition-colors duration-100"
              >
                <SquarePen className="size-[18px]" />
              </button>
            </Tip>
          )}
        </div>

        <nav aria-label="Main" className="shrink-0 space-y-px px-1">
          <SidebarNavButton icon={<Search />} onClick={() => setQuickFindOpen(true)}>
            Search
          </SidebarNavButton>
          <SidebarNavLink to="/home" icon={<Home />} active={pathname === '/home'}>
            Home
          </SidebarNavLink>
          <SidebarNavButton icon={<Settings />} onClick={() => openSettings()}>
            Settings
          </SidebarNavButton>
        </nav>

        <div className="nx-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
          <SidebarFavorites />
          <SidebarPageTree />
        </div>

        <div className="shrink-0 border-t px-1 py-1.5">
          <TrashPopover />
        </div>
      </div>
      <ResizeHandle onResizing={setResizing} />
    </aside>
  )
}
