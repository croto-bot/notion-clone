import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { PageSummary } from '@/types/page'

export type SettingsTab = 'account' | 'appearance' | 'workspace' | 'members'

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 240

const SIDEBAR_OPEN_KEY = 'nx-sidebar-open'
const SIDEBAR_WIDTH_KEY = 'nx-sidebar-width'

interface AppShellContextValue {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  quickFindOpen: boolean
  setQuickFindOpen: (open: boolean) => void
  /** The open tab of the settings modal, or null when it is closed. */
  settingsTab: SettingsTab | null
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  /** The page the "Move to" dialog is moving, or null when it is closed. */
  moveToPage: PageSummary | null
  openMoveTo: (page: PageSummary) => void
  closeMoveTo: () => void
}

const AppShellContext = createContext<AppShellContextValue | undefined>(undefined)

function readOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH) return value
  } catch {
    // Use the default.
  }
  return SIDEBAR_DEFAULT_WIDTH
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: not saved.
  }
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

/** UI state shared by the sidebar, the top bar and the global shortcuts. */
export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpenState] = useState(readOpen)
  const [sidebarWidth, setSidebarWidthState] = useState(readWidth)
  const [quickFindOpen, setQuickFindOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [moveToPage, setMoveToPage] = useState<PageSummary | null>(null)

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open)
    store(SIDEBAR_OPEN_KEY, open ? '1' : '0')
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpenState(open => {
      store(SIDEBAR_OPEN_KEY, open ? '0' : '1')
      return !open
    })
  }, [])

  const setSidebarWidth = useCallback((width: number) => {
    const next = clampSidebarWidth(width)
    setSidebarWidthState(next)
    store(SIDEBAR_WIDTH_KEY, String(next))
  }, [])

  const openSettings = useCallback((tab: SettingsTab = 'account') => setSettingsTab(tab), [])
  const closeSettings = useCallback(() => setSettingsTab(null), [])
  const openMoveTo = useCallback((page: PageSummary) => setMoveToPage(page), [])
  const closeMoveTo = useCallback(() => setMoveToPage(null), [])

  // Global shortcuts: Cmd/Ctrl+K and +P open quick find, Cmd/Ctrl+\ toggles the sidebar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (!event.shiftKey && (key === 'k' || key === 'p')) {
        event.preventDefault()
        setQuickFindOpen(open => !open)
      } else if (!event.shiftKey && event.key === '\\') {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar])

  const value = useMemo(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      sidebarWidth,
      setSidebarWidth,
      quickFindOpen,
      setQuickFindOpen,
      settingsTab,
      openSettings,
      closeSettings,
      moveToPage,
      openMoveTo,
      closeMoveTo,
    }),
    [
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      sidebarWidth,
      setSidebarWidth,
      quickFindOpen,
      settingsTab,
      openSettings,
      closeSettings,
      moveToPage,
      openMoveTo,
      closeMoveTo,
    ]
  )
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

export function useAppShell() {
  const context = useContext(AppShellContext)
  if (context === undefined) throw new Error('useAppShell must be used within an AppShellProvider')
  return context
}
