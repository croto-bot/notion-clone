import React from 'react'
import { ChevronsRight } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { useAppShell } from '@/contexts/AppShellContext'
import { shortcutLabel } from '@/lib/platform'

interface TopbarProps {
  /** Plain title (Home). Pages pass breadcrumbs as children instead. */
  title?: string
  children?: React.ReactNode
  /** Right side: edited time, avatars, buttons. */
  actions?: React.ReactNode
}

/** The 45 px bar above the page. Shows a button that reopens the sidebar when it is closed. */
export function Topbar({ title, children, actions }: TopbarProps) {
  const { sidebarOpen, toggleSidebar } = useAppShell()
  return (
    <header
      data-testid="topbar"
      className="bg-background flex h-[45px] shrink-0 items-center gap-1 px-3 text-[14px]"
    >
      {!sidebarOpen && (
        <Tip label="Open sidebar" hint={shortcutLabel('\\')} side="bottom">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={toggleSidebar}
            className="text-muted-foreground hover:bg-hover mr-1 grid size-7 shrink-0 place-items-center rounded-[4px] transition-colors duration-100"
          >
            <ChevronsRight className="size-[18px]" />
          </button>
        </Tip>
      )}
      <div className="flex min-w-0 flex-1 items-center">
        {title ? <span className="truncate px-1.5 font-medium">{title}</span> : children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </header>
  )
}

/** A 28 px icon button of the top bar. */
export const TopbarButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> & { active?: boolean }
>(({ className, active, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={`text-muted-foreground hover:bg-hover inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-[4px] px-1.5 text-[14px] transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-hover-strong [&_svg]:size-[18px] ${
      active ? 'bg-hover-strong text-foreground' : ''
    } ${className ?? ''}`}
    {...props}
  />
))
TopbarButton.displayName = 'TopbarButton'
