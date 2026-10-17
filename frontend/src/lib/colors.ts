/** Cursor and avatar colors: readable on white and on dark backgrounds. */
const USER_COLORS = [
  '#e03e3e',
  '#d9730d',
  '#c29243',
  '#0f7b6c',
  '#0b6e99',
  '#6940a5',
  '#ad1a72',
  '#64473a',
  '#2eaadc',
  '#9065b0',
] as const

function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0
  return Math.abs(value)
}

/** The same user always gets the same color, on every device. */
export function colorForUser(userId: string): string {
  return USER_COLORS[hash(userId) % USER_COLORS.length]
}

/** Notion's palette for select options and block colors: text color + soft background. */
export const NOTION_COLORS = {
  default: {
    text: 'rgb(55, 53, 47)',
    bg: 'rgba(227, 226, 224, 0.5)',
    dot: 'rgba(206, 205, 202, 0.5)',
  },
  gray: { text: 'rgb(50, 48, 44)', bg: 'rgb(227, 226, 224)', dot: 'rgb(155, 154, 151)' },
  brown: { text: 'rgb(68, 42, 30)', bg: 'rgb(238, 224, 218)', dot: 'rgb(155, 100, 80)' },
  orange: { text: 'rgb(73, 41, 14)', bg: 'rgb(250, 222, 201)', dot: 'rgb(217, 115, 13)' },
  yellow: { text: 'rgb(64, 44, 27)', bg: 'rgb(253, 236, 200)', dot: 'rgb(223, 171, 1)' },
  green: { text: 'rgb(28, 56, 41)', bg: 'rgb(219, 237, 219)', dot: 'rgb(68, 131, 97)' },
  blue: { text: 'rgb(24, 51, 71)', bg: 'rgb(211, 229, 239)', dot: 'rgb(51, 126, 169)' },
  purple: { text: 'rgb(65, 36, 84)', bg: 'rgb(232, 222, 238)', dot: 'rgb(144, 101, 176)' },
  pink: { text: 'rgb(76, 35, 55)', bg: 'rgb(245, 224, 233)', dot: 'rgb(193, 76, 138)' },
  red: { text: 'rgb(93, 23, 21)', bg: 'rgb(255, 226, 221)', dot: 'rgb(212, 76, 71)' },
} as const

export type NotionColorName = keyof typeof NOTION_COLORS

export const NOTION_COLOR_NAMES = Object.keys(NOTION_COLORS) as NotionColorName[]

export function notionColor(name: string | undefined) {
  return NOTION_COLORS[
    (name as NotionColorName) in NOTION_COLORS ? (name as NotionColorName) : 'default'
  ]
}

/** Presets of the cover picker: gradients and flat colors, no external images. */
export const COVER_PRESETS = [
  { key: 'gradient-1', label: 'Sunrise', css: 'linear-gradient(135deg, #ffd1a9 0%, #ff9a9e 100%)' },
  { key: 'gradient-2', label: 'Ocean', css: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
  { key: 'gradient-3', label: 'Forest', css: 'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)' },
  { key: 'gradient-4', label: 'Dusk', css: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
  { key: 'gradient-5', label: 'Peach', css: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' },
  { key: 'gradient-6', label: 'Night', css: 'linear-gradient(135deg, #434343 0%, #000000 100%)' },
  { key: 'color-red', label: 'Red', css: '#e03e3e' },
  { key: 'color-orange', label: 'Orange', css: '#d9730d' },
  { key: 'color-yellow', label: 'Yellow', css: '#dfab01' },
  { key: 'color-green', label: 'Green', css: '#0f7b6c' },
  { key: 'color-blue', label: 'Blue', css: '#0b6e99' },
  { key: 'color-purple', label: 'Purple', css: '#6940a5' },
] as const

/** One rule, both sides of the wire: a cover is a preset key, or a URL
 * whose raw value starts with `https://` (either case, so `https:example.com`
 * and `https:///x` are out), whose netloc carries no whitespace, whose host
 * is non-empty and whose port, if any, is 1..65535 — the same checks the
 * backend runs with urllib.parse (`PageUpdate.cover_is_a_preset_or_an_https_url`).
 * The shared case list lives in backend/tests/e2e/test_databases.py and
 * frontend/e2e/pages.spec.ts. */
export function isRenderableCover(cover: string | null | undefined): boolean {
  if (!cover) return false
  if (COVER_PRESETS.some(item => item.key === cover)) return true
  if (!/^https:\/\//i.test(cover)) return false
  // The netloc runs from after "https://" to the first /, ? or #; it must
  // be non-empty and whitespace-free. The URL parser alone would accept
  // "https:///x" (WHATWG skips the extra slash and reads host "x"), so the
  // emptiness has to be checked on the raw value, like the server does.
  const netloc = cover.slice(8).split(/[/?#]/)[0]
  if (netloc === '' || /\s/.test(netloc)) return false
  try {
    const url = new URL(cover)
    // A port out of range makes the URL constructor throw; 0 parses, so the
    // range check still runs here.
    const port = url.port === '' ? null : Number(url.port)
    return (
      url.protocol === 'https:' &&
      url.hostname !== '' &&
      (port === null || (port >= 1 && port <= 65535))
    )
  } catch {
    return false
  }
}

/** CSS `background` for a page cover: a preset key or an https image URL.
 * Anything else (a stale value, another scheme) renders no background. */
export function coverBackground(
  cover: string,
  position: number
):
  | { background: string }
  | { backgroundImage: string; backgroundSize: string; backgroundPosition: string }
  | undefined {
  const preset = COVER_PRESETS.find(item => item.key === cover)
  if (preset) return { background: preset.css }
  if (!isRenderableCover(cover)) return undefined
  return {
    backgroundImage: `url("${cover.replace(/"/g, '%22')}")`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${position}%`,
  }
}
