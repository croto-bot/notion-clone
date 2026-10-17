import { cn } from '@/lib/utils'

/** Own mark: a page with a folded corner. Not a boxed letter. */
export function NotionLogo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
    >
      <path
        fill="currentColor"
        d="M8.2 4.8h10.6L26.2 12.2V25.2a2.4 2.4 0 0 1-2.4 2.4H8.2a2.4 2.4 0 0 1-2.4-2.4V7.2a2.4 2.4 0 0 1 2.4-2.4z"
      />
      <path fill="var(--background)" d="M18.6 5.1 25.6 12.1h-5.8a1.2 1.2 0 0 1-1.2-1.2V5.1z" />
      <path fill="var(--background)" d="M11 16.2h8.4v1.8H11zm0 4.2h5.6v1.8H11z" />
    </svg>
  )
}
