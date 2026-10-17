import type { UserRef } from './page'

export interface Comment {
  id: string
  page_id: string
  /** null = the first comment of a discussion. */
  parent_id: string | null
  body: string
  resolved: boolean
  edited: boolean
  author: UserRef
  created_at: string
  updated_at: string
}

export interface CreateCommentData {
  body: string
  parent_id?: string | null
}

export interface UpdateCommentData {
  body?: string
  resolved?: boolean
}

/** A discussion: its first comment and the replies, oldest first. */
export interface CommentThread {
  root: Comment
  replies: Comment[]
}
