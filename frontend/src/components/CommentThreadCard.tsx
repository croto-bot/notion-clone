import { useState } from 'react'
import { Check, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { CommentComposer } from '@/components/CommentComposer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAddComment, useDeleteComment, useUpdateComment } from '@/hooks/useComments'
import { displayNameOf, useCurrentUser } from '@/hooks/useUser'
import { toastApiError } from '@/lib/error-handler'
import { formatRelative } from '@/lib/time'
import type { Comment, CommentThread } from '@/types/comment'

function CommentItem({
  comment,
  pageId,
  canResolve,
  isRoot,
}: {
  comment: Comment
  pageId: string
  canResolve: boolean
  isRoot: boolean
}) {
  const { data: me } = useCurrentUser()
  const { isOwner } = useWorkspace()
  const update = useUpdateComment(pageId)
  const remove = useDeleteComment(pageId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const isAuthor = me?.id === comment.author.id
  const name = displayNameOf(comment.author)

  const saveEdit = async () => {
    const body = draft.trim()
    if (!body) return
    try {
      await update.mutateAsync({ id: comment.id, data: { body } })
      setEditing(false)
    } catch (error) {
      toastApiError(error, 'Could not save the comment')
    }
  }

  const toggleResolved = async () => {
    try {
      await update.mutateAsync({ id: comment.id, data: { resolved: !comment.resolved } })
    } catch (error) {
      toastApiError(error, 'Could not update the discussion')
    }
  }

  const doDelete = async () => {
    try {
      await remove.mutateAsync(comment.id)
    } catch (error) {
      toastApiError(error, 'Could not delete the comment')
    }
  }

  return (
    <div className="group/comment flex gap-2" data-testid="comment">
      <Avatar name={name} seed={comment.author.id} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate font-semibold">{name}</span>
          <span className="text-subtle shrink-0 text-[12px]">
            {formatRelative(comment.created_at)}
            {comment.edited && ' · edited'}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100">
            {isRoot && canResolve && (
              <Tip label={comment.resolved ? 'Re-open discussion' : 'Resolve discussion'}>
                <button
                  type="button"
                  aria-label={comment.resolved ? 'Re-open discussion' : 'Resolve discussion'}
                  onClick={() => void toggleResolved()}
                  className="text-muted-foreground hover:bg-hover-strong grid size-6 place-items-center rounded-[4px]"
                >
                  {comment.resolved ? (
                    <RotateCcw className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </button>
              </Tip>
            )}
            {(isAuthor || isOwner) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Comment options"
                    className="text-muted-foreground hover:bg-hover-strong grid size-6 place-items-center rounded-[4px]"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[160px]">
                  {isAuthor && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(comment.body)
                        setEditing(true)
                      }}
                    >
                      <Pencil />
                      Edit comment
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onSelect={() => void doDelete()}>
                    <Trash2 />
                    Delete comment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's "Edit comment" click
              autoFocus
              aria-label="Edit comment"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void saveEdit()
                } else if (event.key === 'Escape') {
                  setEditing(false)
                }
              }}
              rows={2}
              className="bg-input min-h-[56px] w-full resize-none rounded-[4px] p-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57)]"
            />
            <div className="mt-1 flex justify-end gap-1.5 text-[13px]">
              <button
                type="button"
                className="hover:bg-hover h-6 rounded-[4px] px-2"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bg-primary hover:bg-primary-hover h-6 rounded-[4px] px-2 text-white"
                onClick={() => void saveEdit()}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-[14px] leading-[1.4] break-words whitespace-pre-wrap">
            {comment.body}
          </p>
        )}
      </div>
    </div>
  )
}

/** One discussion: the first comment, its replies and a reply box. */
export function CommentThreadCard({ thread, pageId }: { thread: CommentThread; pageId: string }) {
  const { canEdit } = useWorkspace()
  const add = useAddComment(pageId)
  const [replying, setReplying] = useState(false)
  const { root, replies } = thread

  const reply = async (body: string) => {
    try {
      await add.mutateAsync({ body, parent_id: root.id })
      setReplying(false)
    } catch (error) {
      toastApiError(error, 'Could not add the reply')
      throw error
    }
  }

  return (
    <article
      aria-label={`Discussion by ${displayNameOf(root.author)}`}
      data-resolved={root.resolved}
      className="bg-background space-y-3 rounded-[8px] p-3 shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(15,15,15,0.04)]"
    >
      <CommentItem comment={root} pageId={pageId} canResolve={canEdit} isRoot />
      {replies.map(item => (
        <CommentItem
          key={item.id}
          comment={item}
          pageId={pageId}
          canResolve={false}
          isRoot={false}
        />
      ))}
      {replying ? (
        <CommentComposer
          focusOnMount
          label="Reply"
          placeholder="Reply…"
          onSubmit={reply}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setReplying(true)}
          className="text-subtle hover:bg-hover w-full rounded-[4px] px-2 py-1 text-left text-[13px] transition-colors duration-100"
        >
          Reply…
        </button>
      )}
    </article>
  )
}
