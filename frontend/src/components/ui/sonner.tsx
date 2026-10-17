import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/contexts/ThemeContext'

/** Dark pill toasts at the bottom, like Notion's. */
function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="bottom-center"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: '!rounded-[6px] !text-[14px] !shadow-menu',
          actionButton: '!rounded-[4px] !bg-primary !text-white',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '6px',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
