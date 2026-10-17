import { cn } from '@/lib/utils'

/** The brand mark: a rounded square with a serif "N", like Notion's. */
export function NotionLogo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
    >
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="5"
        fill="var(--background)"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path d="M10.2 22.6V9.6h1.9l7.7 9.6V9.6h1.9v13h-1.8l-7.8-9.7v9.7z" fill="currentColor" />
    </svg>
  )
}
