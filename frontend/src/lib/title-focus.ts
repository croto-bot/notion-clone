/**
 * A page just created from the sidebar opens with the cursor in its title, like
 * Notion. The creator asks here, and the page header takes the request once.
 */
const requested = new Set<string>()

export function requestTitleFocus(pageId: string) {
  requested.add(pageId)
}

/** True once per request. */
export function consumeTitleFocus(pageId: string): boolean {
  return requested.delete(pageId)
}
