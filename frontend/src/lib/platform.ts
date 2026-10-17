/** True on macOS and iOS, where the shortcut key is Cmd instead of Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

/** "⌘K" / "Ctrl+K" */
export function shortcutLabel(key: string, { shift = false }: { shift?: boolean } = {}): string {
  if (isMac()) return `${shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`
}
