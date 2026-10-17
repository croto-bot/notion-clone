import { FileText, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PageKind } from '@/types/page'

interface PageIconProps {
  icon: string | null | undefined
  kind?: PageKind
  /** Box size in px. */
  size?: number
  /** Emoji font size as a share of the box. Small icons use a slightly smaller emoji. */
  emojiScale?: number
  className?: string
}

/** The emoji of a page, or Notion's page glyph (a table glyph for databases). */
export function PageIcon({
  icon,
  kind = 'page',
  size = 20,
  emojiScale = 0.82,
  className,
}: PageIconProps) {
  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
        style={{ width: size, height: size, fontSize: Math.round(size * emojiScale) }}
      >
        {icon}
      </span>
    )
  }
  const Glyph = kind === 'database' ? Table2 : FileText
  return (
    <span
      aria-hidden="true"
      className={cn(
        'text-muted-foreground inline-flex shrink-0 items-center justify-center',
        className
      )}
      style={{ width: size, height: size }}
    >
      <Glyph
        style={{ width: Math.round(size * 0.9), height: Math.round(size * 0.9) }}
        strokeWidth={1.6}
      />
    </span>
  )
}
