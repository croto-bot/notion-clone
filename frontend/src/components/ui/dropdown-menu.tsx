import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

import { cn } from '@/lib/utils'

/** Classes of one Notion menu row (28 px, 3 px radius). Shared with popover lists. */
export const menuItemClass =
  'relative flex min-h-[28px] w-[calc(100%-8px)] mx-1 select-none items-center gap-2 rounded-[3px] px-2 py-1 text-left text-[14px] leading-[1.2] outline-none transition-colors duration-100 data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'nx-pop bg-popover text-popover-foreground shadow-menu z-[60] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[200px] overflow-y-auto overflow-x-hidden rounded-[6px] py-1 text-[14px]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(
          'nx-pop bg-popover text-popover-foreground shadow-menu z-[60] min-w-[180px] overflow-hidden rounded-[6px] py-1 text-[14px]',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        menuItemClass,
        variant === 'destructive' && 'text-destructive [&_svg]:text-destructive',
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItemClass, 'data-[state=open]:bg-hover', className)}
      {...props}
    >
      {children}
      <span aria-hidden className="text-subtle ml-auto text-[12px]">
        ›
      </span>
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('text-subtle px-3 pt-1.5 pb-1 text-[12px] font-medium', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('bg-border mx-0 my-1 h-px', className)}
      {...props}
    />
  )
}

/** Right-aligned hint inside a menu row, e.g. a keyboard shortcut. */
function MenuHint({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('text-subtle ml-auto pl-4 text-[12px]', className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  MenuHint,
}
