/**
 * The one place that turns the stored theme choice into the theme on screen.
 *
 * `__root.tsx` renders `THEME_SCRIPT` (built from `applyStoredTheme` itself)
 * into `<head>`, so the resolved theme is on the document before the first
 * paint, and `ThemeProvider` calls the same function after every change. The
 * two paths cannot drift because there is only one function.
 */

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** localStorage key of the theme choice. */
export const THEME_KEY = 'nx-theme'

declare global {
  interface Window {
    /**
     * Every theme this tab has applied, oldest first: the pre-paint script
     * first, then each application by the provider. Dev builds only (the e2e
     * suite runs the dev server and reads it to prove the wrong theme never
     * appeared); production never creates it.
     */
    __nxThemeHistory?: string[]
  }
}

/**
 * The resolver: the stored value ('light' | 'dark' | 'system'; unreadable or
 * invalid storage counts as no choice), 'system' resolved through the OS
 * preference, applied to the document as the `dark` class, `color-scheme`
 * and the browser-chrome color (`<meta name="theme-color">`, the light and
 * dark `--background`). With `record`, also appends to
 * `window.__nxThemeHistory`. Returns what it applied.
 */
export function applyStoredTheme(
  key: string,
  storage: Pick<Storage, 'getItem'> | null,
  prefersDark: boolean,
  record: boolean
): ResolvedTheme {
  let picked: Theme = 'system'
  try {
    const stored = storage ? storage.getItem(key) : null
    if (stored === 'light' || stored === 'dark' || stored === 'system') picked = stored
  } catch {
    // Storage that throws while reading behaves like no stored choice.
  }
  const resolved = picked === 'system' ? (prefersDark ? 'dark' : 'light') : picked
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#191919' : '#ffffff')
  if (record) (window.__nxThemeHistory ??= []).push(resolved)
  return resolved
}

/** localStorage, or null where the browser blocks access to it. */
export function safeStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/**
 * The stored choice, or 'system' for anything else (missing, invalid, or a
 * storage that cannot be read). The same rule `applyStoredTheme` inlines;
 * this pure form is for reading during render.
 */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try {
    const stored = storage ? storage.getItem(THEME_KEY) : null
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Falls through to 'system'.
  }
  return 'system'
}

/** Whether the OS currently prefers dark mode. */
export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * The pre-paint head script: the shared resolver, with the storage and media
 * access guarded so a browser that blocks either still resolves 'system'.
 */
// applyStoredTheme is inlined here as source text: it may use only its parameters and browser globals.
export const THEME_SCRIPT = [
  '(function(){',
  'var s=null,d=false;',
  'try{s=localStorage}catch(e){}',
  "try{d=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}",
  `try{(${applyStoredTheme.toString()})(${JSON.stringify(THEME_KEY)},s,d,${JSON.stringify(import.meta.env.DEV)})}catch(e){}`,
  '})()',
].join('')
