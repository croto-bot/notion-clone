import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react'
import {
  applyStoredTheme,
  prefersDark,
  readStoredTheme,
  safeStorage,
  THEME_KEY,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme'

export type { Theme, ResolvedTheme } from '@/lib/theme'

interface ThemeContextValue {
  /** What the user picked. */
  theme: Theme
  /** What is on screen: `system` resolved with the OS setting. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  /** Cmd/Ctrl+Shift+L: flips between light and dark. */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', listener)
    window.removeEventListener('storage', listener)
  }
}

// One snapshot string ("light" | "dark" | "system:light" | "system:dark") keeps the store primitive.
function getSnapshot(): string {
  const theme = readStoredTheme(safeStorage())
  if (theme !== 'system') return theme
  return prefersDark() ? 'system:dark' : 'system:light'
}
const getServerSnapshot = () => 'system:light'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const theme: Theme = snapshot.startsWith('system') ? 'system' : (snapshot as Theme)
  const resolvedTheme: ResolvedTheme = snapshot.endsWith('dark') ? 'dark' : 'light'

  // useLayoutEffect, not useEffect: this runs before the browser paints.
  //
  // It reads storage and matchMedia itself instead of applying the render
  // snapshot: during hydration that snapshot is still the server one
  // ('system:light'), and applying it would overwrite the theme the head
  // script already painted. The snapshot is only the signal that the choice
  // changed (pick, OS switch, another tab).
  useLayoutEffect(() => {
    applyStoredTheme(THEME_KEY, safeStorage(), prefersDark(), import.meta.env.DEV)
  }, [snapshot])

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
    listeners.forEach(listener => listener())
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(getSnapshot().endsWith('dark') ? 'light' : 'dark')
  }, [setTheme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleTheme])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
