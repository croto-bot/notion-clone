import { createContext, useContext } from 'react'
import type { PageKind } from '@/types/page'

/** What a page-link block shows about the page it points to. */
export interface PageLinkInfo {
  title: string
  icon: string | null
  kind: PageKind
  /** `/p/<id>` in the app, `/share/<public id>` on a public page; null when there is nowhere to go. */
  href:
    | { to: '/p/$pageId'; params: { pageId: string } }
    | { to: '/share/$publicId'; params: { publicId: string } }
    | null
}

export type PageLinkResolver = (pageId: string) => PageLinkInfo | undefined

/** The editor tree provides this: blocks look their page up here, so they work in the app and on public pages. */
export const PageLinkContext = createContext<PageLinkResolver>(() => undefined)

export function usePageLink(pageId: string): PageLinkInfo | undefined {
  return useContext(PageLinkContext)(pageId)
}
