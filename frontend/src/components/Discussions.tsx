import { useMemo } from 'react'
import { CommentComposer } from '@/components/CommentComposer'
import { CommentThreadCard } from '@/components/CommentThreadCard'
import { useAddComment, useComments, groupThreads } from '@/hooks/useComments'
import { toastApiError } from '@/lib/error-handler'

interface DiscussionsProps {
  pageId: string
  /** True while the "Add comment" box under the title is open. */
  composing: boolean
  onDoneComposing: () => void
}

/** Open discussions under the title, like Notion's page comments. */
export function Discussions({ pageId, composing, onDoneComposing }: DiscussionsProps) {
  const { data: comments = [] } = useComments(pageId)
  const add = useAddComment(pageId)
  const open = useMemo(
    () => groupThreads(comments).filter(thread => !thread.root.resolved),
    [comments]
  )

  const create = async (body: string) => {
    try {
      await add.mutateAsync({ body })
      onDoneComposing()
    } catch (error) {
      toastApiError(error, 'Could not add the comment')
      throw error
    }
  }

  if (open.length === 0 && !composing) return null
  return (
    <section aria-label="Discussions" className="mb-4 space-y-2">
      {open.map(thread => (
        <CommentThreadCard key={thread.root.id} thread={thread} pageId={pageId} />
      ))}
      {composing && (
        <CommentComposer
          focusOnMount
          label="Add a comment"
          placeholder="Add a comment…"
          onSubmit={create}
          onCancel={onDoneComposing}
        />
      )}
    </section>
  )
}
