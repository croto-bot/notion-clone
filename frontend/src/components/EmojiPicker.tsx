import { Shuffle } from 'lucide-react'
import { EmojiPicker as Frimousse } from 'frimousse'
import { randomEmoji, resolveEmojiData } from '@/features/emoji/emoji-data'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  /** When set, a "Remove" button clears the current icon. */
  onRemove?: () => void
}

/** Notion's emoji picker: search, a grid by category, "Random" and "Remove". */
export function EmojiPicker({ onSelect, onRemove }: EmojiPickerProps) {
  return (
    <Frimousse.Root
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
      resolveEmojiData={resolveEmojiData}
      columns={9}
      className="flex h-[360px] w-[342px] flex-col"
    >
      <div className="flex items-center gap-1.5 border-b p-2">
        <Frimousse.Search
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker opens for searching
          autoFocus
          aria-label="Filter emoji"
          placeholder="Filter…"
          className="bg-input placeholder:text-subtle h-7 min-w-0 flex-1 rounded-[4px] px-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57),0_0_0_2px_rgba(35,131,226,0.35)]"
        />
        <button
          type="button"
          aria-label="Random emoji"
          onClick={() => void randomEmoji().then(onSelect)}
          className="text-muted-foreground hover:bg-hover flex h-7 items-center gap-1 rounded-[4px] px-1.5 text-[13px] transition-colors duration-100"
        >
          <Shuffle className="size-3.5" />
          Random
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:bg-hover h-7 rounded-[4px] px-1.5 text-[13px] transition-colors duration-100"
          >
            Remove
          </button>
        )}
      </div>
      <Frimousse.Viewport className="nx-scroll relative flex-1 outline-none">
        <Frimousse.Loading className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[13px]">
          Loading…
        </Frimousse.Loading>
        <Frimousse.Empty className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[13px]">
          No emoji found
        </Frimousse.Empty>
        <Frimousse.List
          className="pb-2 select-none"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                className="bg-popover text-subtle px-3 pt-2.5 pb-1 text-[12px] font-medium"
                {...props}
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div className="scroll-my-1 px-2" {...props}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                className="data-[active]:bg-hover-strong flex size-[34px] items-center justify-center rounded-[4px] text-[22px] transition-colors duration-100"
                {...props}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </Frimousse.Viewport>
    </Frimousse.Root>
  )
}
