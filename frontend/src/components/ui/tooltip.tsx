import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

function TooltipProvider({
  delayDuration = 400,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={100}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'nx-fade z-[70] max-w-[280px] rounded-[4px] bg-[rgb(15,15,15)] px-2 py-1 text-center text-[12px] leading-[1.3] font-medium text-white shadow-menu dark:bg-[rgb(55,55,55)]',
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

interface TipProps {
  label: React.ReactNode
  /** A second, dimmer line, e.g. a keyboard shortcut. */
  hint?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactElement
}

/** Wraps one element in a Notion-style tooltip. */
function Tip({ label, hint, side = 'bottom', children }: TipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side}>
        <div>{label}</div>
        {hint ? <div className="text-white/60">{hint}</div> : null}
      </TooltipContent>
    </TooltipPrimitive.Root>
  )
}

export { TooltipProvider, TooltipContent, Tip }
