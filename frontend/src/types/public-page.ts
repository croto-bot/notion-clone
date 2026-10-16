import type { DatabaseProperty, DatabaseView, RowProperties } from './database'
import type { PageFont, PageKind } from './page'

export interface PublicRow {
  id: string
  title: string
  icon: string | null
  properties: RowProperties
}

export interface PublicChild {
  id: string
  title: string
  icon: string | null
  public_id: string
}

/** `GET /public/pages/{public_id}` (no sign-in). */
export interface PublicPage {
  id: string
  title: string
  icon: string | null
  cover: string | null
  cover_position: number
  full_width: boolean
  small_text: boolean
  font: PageFont
  kind: PageKind
  /** Base64 Yjs update, or null. */
  state: string | null
  database_schema: DatabaseProperty[] | null
  database_views: DatabaseView[] | null
  rows: PublicRow[]
  children: PublicChild[]
}
