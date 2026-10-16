import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { API } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import type { Comment, CommentThread, CreateCommentData, UpdateCommentData } from '@/types/comment'

export function useComments(pageId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.comments.list(pageId ?? ''),
    queryFn: () => api.get<Comment[]>(API.PAGES.COMMENTS(pageId!)),
    enabled: !!pageId && enabled,
    staleTime: 30 * 1000,
  })
}

/** Groups the flat, oldest-first list into discussions: a first comment and its replies. */
export function groupThreads(comments: Comment[]): CommentThread[] {
  const byId = new Map(comments.map(comment => [comment.id, comment]))
  const threads = new Map<string, CommentThread>()
  for (const comment of comments) {
    if (comment.parent_id === null) threads.set(comment.id, { root: comment, replies: [] })
  }
  for (const comment of comments) {
    if (comment.parent_id === null) continue
    // A reply to a reply still belongs to the discussion of the first comment.
    let root = byId.get(comment.parent_id)
    while (root && root.parent_id !== null) root = byId.get(root.parent_id)
    if (root) threads.get(root.id)?.replies.push(comment)
  }
  return [...threads.values()]
}

export function useAddComment(pageId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCommentData) => api.post<Comment>(API.PAGES.COMMENTS(pageId), data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.list(pageId) })
    },
  })
}

export function useUpdateComment(pageId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCommentData }) =>
      api.patch<Comment>(API.COMMENTS.DETAIL(id), data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.list(pageId) })
    },
  })
}

export function useDeleteComment(pageId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(API.COMMENTS.DETAIL(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.list(pageId) })
    },
  })
}
