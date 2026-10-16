import React from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

const rowClass =
  'flex h-[28px] w-full items-center gap-2 rounded-[4px] px-2 text-left text-[14px] font-medium text-muted-foreground transition-colors duration-100 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px] [&_svg]:shrink-0'

interface RowProps {
  icon: React.ReactNode
  children: React.ReactNode
  active?: boolean
  className?: string
}

/** A Search / Home / Settings / Trash row of the sidebar (28 px). */
export const SidebarNavButton = React.forwardRef<
  HTMLButtonElement,
  RowProps & Omit<React.ComponentProps<'button'>, 'className' | 'children'>
>(({ icon, children, active, className, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(rowClass, active && 'bg-hover-strong text-foreground', className)}
    {...props}
  >
    {icon}
    <span className="truncate">{children}</span>
  </button>
))
SidebarNavButton.displayName = 'SidebarNavButton'

export function SidebarNavLink({
  icon,
  children,
  active,
  className,
  ...props
}: RowProps & LinkProps) {
  return (
    <Link
      className={cn(rowClass, active && 'bg-hover-strong text-foreground', className)}
      {...props}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  )
}
