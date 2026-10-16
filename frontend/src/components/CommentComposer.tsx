import { useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useCurrentUser, displayNameOf } from '@/hooks/useUser'
import { cn } from '@/lib/utils'

interface CommentComposerProps {
  placeholder: string
  /** Called with the trimmed text. Resolve to clear the box, reject to keep the text. */
  onSubmit: (body: string) => Promise<unknown>
  onCancel?: () => void
  /** Put the cursor in the box when it appears. */
  focusOnMount?: boolean
  /** The accessible name of the box. */
  label: string
  className?: string
}

/** A comment box: Enter sends, Shift+Enter adds a line, Escape cancels. */
export function CommentComposer({
  placeholder,
  onSubmit,
  onCancel,
  focusOnMount,
  label,
  className,
}: CommentComposerProps) {
  const { data: me } = useCurrentUser()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !busy

  const grow = () => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`
  }

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
      setValue('')
      requestAnimationFrame(grow)
    } catch {
      // The caller shows the error; keep the text so nothing is lost.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'bg-background flex items-start gap-2 rounded-[6px] p-2 shadow-[0_0_0_1px_var(--input-ring)] transition-shadow duration-100 focus-within:shadow-[0_0_0_1px_rgba(35,131,226,0.57),0_0_0_3px_rgba(35,131,226,0.25)]',
        className
      )}
    >
      {me && <Avatar name={displayNameOf(me)} seed={me.id} size={24} className="mt-0.5" />}
      <textarea
        ref={ref}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's click on "Add comment" or "Reply"
        autoFocus={focusOnMount}
        rows={1}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={event => {
          setValue(event.target.value)
          grow()
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          } else if (event.key === 'Escape' && onCancel) {
            event.stopPropagation()
            onCancel()
          }
        }}
        className="placeholder:text-subtle max-h-40 min-h-6 min-w-0 flex-1 resize-none bg-transparent py-[3px] text-[14px] leading-[18px] outline-none"
      />
      <button
        type="button"
        aria-label="Send comment"
        disabled={!canSend}
        onClick={() => void send()}
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white transition-colors duration-100',
          canSend ? 'bg-primary hover:bg-primary-hover' : 'bg-pressed'
        )}
      >
        <ArrowUp className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}
