/** The name users see. Repo and code identifiers stay as they are. */
export const PRODUCT_NAME = 'Noted'

/** The workspace a new account gets. Capped at 100 code points by the caller. */
export function defaultWorkspaceName(displayName: string): string {
  return `${displayName}'s Workspace`
}
