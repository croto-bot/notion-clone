import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** localStorage key of the theme choice. The inline script in __root.tsx reads the same key. */
export const THEME_KEY = 'nx-theme'

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

function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

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
  const theme = readStoredTheme()
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'system:dark' : 'system:light'
}
const getServerSnapshot = () => 'system:light'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const theme: Theme = snapshot.startsWith('system') ? 'system' : (snapshot as Theme)
  const resolvedTheme: ResolvedTheme = snapshot.endsWith('dark') ? 'dark' : 'light'

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

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
