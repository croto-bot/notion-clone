import { cn } from '@/lib/utils'

interface WorkspaceIconProps {
  name: string
  icon: string | null
  size?: number
  className?: string
}

/** A workspace emoji, or its first letter on a soft background. */
export function WorkspaceIcon({ name, icon, size = 20, className }: WorkspaceIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] leading-none font-semibold select-none',
        !icon && 'bg-[rgba(55,53,47,0.1)] text-foreground/70 dark:bg-white/15',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * (icon ? 0.8 : 0.58)) }}
    >
      {icon ?? (name.trim().charAt(0).toUpperCase() || 'N')}
    </span>
  )
}
