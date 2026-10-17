import { colorForUser } from '@/lib/colors'
import { cn } from '@/lib/utils'

interface AvatarProps {
  /** Shown as the first letter and as the tooltip/accessible name. */
  name: string
  /** Seed of the color: a user id keeps the same color on every screen. */
  seed?: string
  color?: string
  size?: number
  className?: string
  title?: string
}

/** A round badge with the user's initial, colored per user like Notion's. */
export function Avatar({ name, seed, color, size = 24, className, title }: AvatarProps) {
  const letter = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      role="img"
      aria-label={name}
      title={title ?? name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold text-white select-none',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        backgroundColor: color ?? colorForUser(seed ?? name),
      }}
    >
      {letter}
    </span>
  )
}
