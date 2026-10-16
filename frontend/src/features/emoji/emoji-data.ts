import type { EmojiMartData } from '@emoji-mart/data'
import type { EmojiData, EmojiDataResolver } from 'frimousse'

type EmojiEntry = EmojiData['emojis'][number]

// Order and names of the emoji-mart categories.
const CATEGORY_LABELS = [
  'Smileys & People',
  'Animals & Nature',
  'Food & Drink',
  'Activities',
  'Travel & Places',
  'Objects',
  'Symbols',
  'Flags',
] as const

/** Skin tones in emoji-mart's `skins` order (index 1 to 5), with the swatch emoji for each. */
const SKIN_TONES = [
  ['light', '🏻'],
  ['medium-light', '🏼'],
  ['medium', '🏽'],
  ['medium-dark', '🏾'],
  ['dark', '🏿'],
] as const

let cached: Promise<EmojiData> | undefined

/**
 * The emoji list, built from the `@emoji-mart/data` package (already part of the
 * editor's dependencies) instead of a CDN: the picker works offline and in tests.
 * Loaded on first use, so the data is a separate chunk.
 */
export function loadEmojiData(): Promise<EmojiData> {
  cached ??= (import('@emoji-mart/data') as unknown as Promise<{ default: EmojiMartData }>).then(
    ({ default: data }) => {
      const emojis: EmojiEntry[] = []
      data.categories.forEach((category, index) => {
        for (const id of category.emojis) {
          const entry = data.emojis[id]
          const base = entry?.skins[0]
          if (!entry || !base) continue
          const skins: Partial<Record<(typeof SKIN_TONES)[number][0], string>> = {}
          SKIN_TONES.forEach(([tone], toneIndex) => {
            const skin = entry.skins[toneIndex + 1]
            if (skin) skins[tone] = skin.native
          })
          emojis.push({
            emoji: base.native,
            category: index,
            label: entry.name,
            version: entry.version,
            tags: entry.keywords,
            ...(Object.keys(skins).length === SKIN_TONES.length
              ? { skins: skins as NonNullable<EmojiEntry['skins']> }
              : {}),
          })
        }
      })
      return {
        locale: 'en',
        emojis,
        categories: CATEGORY_LABELS.map((label, index) => ({ index, label })),
        skinTones: Object.fromEntries(
          SKIN_TONES.map(([tone, swatch]) => [tone, swatch])
        ) as EmojiData['skinTones'],
      }
    }
  )
  return cached
}

export const resolveEmojiData: EmojiDataResolver = () => loadEmojiData()

/** A random emoji from the people, nature, food, activity, travel and object groups. */
export async function randomEmoji(): Promise<string> {
  const { emojis } = await loadEmojiData()
  const pool = emojis.filter(emoji => emoji.category <= 5)
  return pool[Math.floor(Math.random() * pool.length)].emoji
}
