import type { DatabaseProperty, DatabaseView, RowProperties } from './database'
import type { Role } from './workspace'

export type PageKind = 'page' | 'database'

export type PageFont = 'default' | 'serif' | 'mono'

export interface UserRef {
  id: string
  display_name: string
  email: string
}

export interface Breadcrumb {
  id: string
  title: string
  icon: string | null
}

export interface PageSummary {
  id: string
  workspace_id: string
  parent_id: string | null
  kind: PageKind
  title: string
  /** An emoji. */
  icon: string | null
  /** Fractional index among siblings (compare as plain strings). */
  position: string
  is_public: boolean
  deleted_at: string | null
  updated_at: string
  last_edited_at: string
  has_children: boolean
}

export interface PageResponse extends PageSummary {
  /** A URL or a preset key such as `gradient-1`. */
  cover: string | null
  /** 0..100 */
  cover_position: number
  full_width: boolean
  small_text: boolean
  locked: boolean
  font: PageFont
  public_id: string | null
  created_by: UserRef | null
  last_edited_by: UserRef | null
  created_at: string
  database_schema: DatabaseProperty[] | null
  database_views: DatabaseView[] | null
  properties: RowProperties
  /** Root first, without the page itself. */
  breadcrumbs: Breadcrumb[]
  is_favorite: boolean
  /** My role in the workspace. */
  role: Role
}

export interface SearchResult extends PageSummary {
  snippet: string
  breadcrumbs: Breadcrumb[]
}

export interface CreatePageData {
  workspace_id: string
  parent_id?: string | null
  kind?: PageKind
  title?: string
  icon?: string | null
  after_id?: string | null
  properties?: RowProperties
}

export interface UpdatePageData {
  title?: string
  icon?: string | null
  cover?: string | null
  cover_position?: number
  full_width?: boolean
  small_text?: boolean
  locked?: boolean
  font?: PageFont
  is_public?: boolean
  database_schema?: DatabaseProperty[]
  database_views?: DatabaseView[]
  properties?: RowProperties
}

export interface MovePageData {
  parent_id: string | null
  /** `null` = first; a missing key = last. */
  after_id?: string | null
}

export interface DocumentResponse {
  /** Base64 Yjs update, or null for a page that was never edited. */
  state: string | null
}
