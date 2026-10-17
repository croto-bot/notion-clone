import * as React from 'react'
import { cn } from '@/lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full resize-none rounded-[4px] bg-input px-2.5 py-1.5 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] placeholder:text-subtle focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57),0_0_0_2px_rgba(35,131,226,0.35)] disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
