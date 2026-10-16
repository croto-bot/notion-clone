import { useMemo, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { CommentComposer } from '@/components/CommentComposer'
import { CommentThreadCard } from '@/components/CommentThreadCard'
import { Tip } from '@/components/ui/tooltip'
import { useAddComment, useComments, groupThreads } from '@/hooks/useComments'
import { toastApiError } from '@/lib/error-handler'
import { cn } from '@/lib/utils'

type Filter = 'open' | 'resolved'

/** The right-hand comments panel: all discussions of the page, open and resolved, and a box for a new one. */
export function CommentsPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { data: comments = [], isLoading } = useComments(pageId)
  const add = useAddComment(pageId)
  const [filter, setFilter] = useState<Filter>('open')
  const threads = useMemo(() => groupThreads(comments), [comments])
  const open = threads.filter(thread => !thread.root.resolved)
  const resolved = threads.filter(thread => thread.root.resolved)
  const shown = filter === 'open' ? open : resolved

  const create = async (body: string) => {
    try {
      await add.mutateAsync({ body })
    } catch (error) {
      toastApiError(error, 'Could not add the comment')
      throw error
    }
  }

  return (
    <aside
      aria-label="Comments"
      data-testid="comments-panel"
      className="bg-background animate-in slide-in-from-right-4 fade-in-0 flex h-full w-[340px] shrink-0 flex-col border-l duration-200"
    >
      <div className="flex h-[45px] shrink-0 items-center justify-between px-3">
        <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
          <MessageSquare className="size-4" />
          Comments
        </h2>
        <Tip label="Close">
          <button
            type="button"
            aria-label="Close comments"
            onClick={onClose}
            className="text-muted-foreground hover:bg-hover grid size-6 place-items-center rounded-[4px]"
          >
            <X className="size-4" />
          </button>
        </Tip>
      </div>
      <div role="tablist" aria-label="Discussions" className="flex gap-1 border-b px-3 pb-2">
        {(['open', 'resolved'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              'h-6 rounded-[4px] px-2 text-[13px] font-medium transition-colors duration-100',
              filter === id
                ? 'bg-hover-strong text-foreground'
                : 'text-muted-foreground hover:bg-hover'
            )}
          >
            {id === 'open' ? `Open (${open.length})` : `Resolved (${resolved.length})`}
          </button>
        ))}
      </div>
      <div className="nx-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!isLoading && shown.length === 0 && (
          <p className="text-muted-foreground px-1 py-4 text-center text-[13px]">
            {filter === 'open' ? 'No open comments yet.' : 'No resolved comments.'}
          </p>
        )}
        {shown.map(thread => (
          <CommentThreadCard key={thread.root.id} thread={thread} pageId={pageId} />
        ))}
      </div>
      <div className="border-t p-3">
        <CommentComposer
          label="Add a page comment"
          placeholder="Add a comment to this page…"
          onSubmit={create}
        />
      </div>
    </aside>
  )
}
