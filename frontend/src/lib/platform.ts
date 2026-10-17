/** True on macOS and iOS, where the shortcut key is Cmd instead of Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

/** "⌘" or "Ctrl". */
export function modKeyLabel(): string {
  return isMac() ? '⌘' : 'Ctrl'
}

/** "⌘K" / "Ctrl+K" */
export function shortcutLabel(key: string, { shift = false }: { shift?: boolean } = {}): string {
  if (isMac()) return `${shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`
}

/** True when the event carries the shortcut modifier: Cmd or Ctrl (either works on every platform). */
export function hasMod(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}
