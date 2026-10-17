import type { PageSummary } from '@/types/page'

/** One page of the sidebar with its children, in sibling order. */
export interface TreeNode {
  page: PageSummary
  children: TreeNode[]
}

/** The text shown for a page without a title. */
export const UNTITLED = 'Untitled'

export function pageLabel(page: { title: string }): string {
  return page.title.trim() ? page.title : UNTITLED
}

/**
 * Builds the nested tree from the flat `page-tree` list. Sibling order is the
 * list order (the backend sorts by `position`). A page whose parent is missing
 * from the list (for example, a child of a database row) is left out.
 */
export function buildTree(pages: PageSummary[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const page of pages) nodes.set(page.id, { page, children: [] })
  const roots: TreeNode[] = []
  for (const page of pages) {
    const node = nodes.get(page.id)!
    if (page.parent_id === null) roots.push(node)
    else nodes.get(page.parent_id)?.children.push(node)
  }
  return roots
}

/** Ids of a page and everything under it. */
export function subtreeIds(pages: PageSummary[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const page of pages) {
    if (page.parent_id === null) continue
    childrenOf.set(page.parent_id, [...(childrenOf.get(page.parent_id) ?? []), page.id])
  }
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return ids
}

/** The pages above `pageId`, root first (excluding the page). Stops at a missing parent. */
export function ancestorIds(pages: PageSummary[], pageId: string): string[] {
  const byId = new Map(pages.map(page => [page.id, page]))
  const result: string[] = []
  let current = byId.get(pageId)
  while (current?.parent_id) {
    result.unshift(current.parent_id)
    current = byId.get(current.parent_id)
  }
  return result
}

export interface VisibleRow {
  node: TreeNode
  depth: number
  expanded: boolean
}

/** The rows on screen, top to bottom: a node's children follow it when it is expanded. */
export function flattenVisible(roots: TreeNode[], expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const isExpanded = expanded.has(node.page.id)
      rows.push({ node, depth, expanded: isExpanded })
      if (isExpanded) walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return rows
}

/**
 * Moves a page in a flat list the way the backend will: under `parentId`,
 * after `afterId` (`null` = first, `undefined` = last). Used for the optimistic
 * update of a drag and drop.
 */
export function moveInList(
  pages: PageSummary[],
  id: string,
  parentId: string | null,
  afterId: string | null | undefined
): PageSummary[] {
  const moved = pages.find(page => page.id === id)
  if (!moved) return pages
  const rest = pages.filter(page => page.id !== id)
  const next = { ...moved, parent_id: parentId }
  const siblingIndexes = rest.flatMap((page, index) => (page.parent_id === parentId ? [index] : []))

  let insertAt: number
  if (afterId === undefined) {
    insertAt =
      siblingIndexes.length > 0 ? siblingIndexes[siblingIndexes.length - 1] + 1 : rest.length
  } else if (afterId === null) {
    insertAt = siblingIndexes.length > 0 ? siblingIndexes[0] : rest.length
  } else {
    const afterIndex = rest.findIndex(page => page.id === afterId)
    insertAt = afterIndex === -1 ? rest.length : afterIndex + 1
  }
  return [...rest.slice(0, insertAt), next, ...rest.slice(insertAt)]
}

/** Every id in `ids` and its subtree, removed from the list (optimistic delete). */
export function removeSubtree(pages: PageSummary[], id: string): PageSummary[] {
  const gone = subtreeIds(pages, id)
  return pages.filter(page => !gone.has(page.id))
}

/** Where a dragged row lands, relative to the row under the pointer. */
export type DropZone = 'before' | 'after' | 'inside'

/** The empty strip under the last row: dropping there moves a page to the end of the root. */
export const TAIL_ID = '__tail__'

export interface DropTarget {
  overId: string
  zone: DropZone
}

/** The body of `POST /pages/{id}/move`. */
export interface MoveTarget {
  parentId: string | null
  /** `null` = first among the siblings, `undefined` = last. */
  afterId: string | null | undefined
}

/**
 * Turns a drop (row under the pointer + zone) into a backend move. Returns null
 * when the drop is not allowed (onto itself or its own subtree) or changes nothing.
 */
export function resolveDrop(
  pages: PageSummary[],
  dragId: string,
  drop: DropTarget,
  expanded: ReadonlySet<string>
): MoveTarget | null {
  const dragged = pages.find(page => page.id === dragId)
  if (!dragged) return null
  const blocked = subtreeIds(pages, dragId)
  const siblingsOf = (parentId: string | null) =>
    pages.filter(page => page.parent_id === parentId && page.id !== dragId)

  let target: MoveTarget
  if (drop.overId === TAIL_ID) {
    target = { parentId: null, afterId: undefined }
  } else {
    if (blocked.has(drop.overId)) return null
    const over = pages.find(page => page.id === drop.overId)
    if (!over) return null
    if (drop.zone === 'inside') {
      target = { parentId: over.id, afterId: undefined }
    } else if (drop.zone === 'before') {
      const siblings = siblingsOf(over.parent_id)
      const index = siblings.findIndex(page => page.id === over.id)
      target = { parentId: over.parent_id, afterId: index > 0 ? siblings[index - 1].id : null }
    } else {
      // Below an open parent the page becomes its first child, like Notion.
      const opensChildren = expanded.has(over.id) && pages.some(page => page.parent_id === over.id)
      target = opensChildren
        ? { parentId: over.id, afterId: null }
        : { parentId: over.parent_id, afterId: over.id }
    }
  }

  if (target.parentId !== null && blocked.has(target.parentId)) return null

  if (target.parentId === dragged.parent_id) {
    const all = pages.filter(page => page.parent_id === dragged.parent_id)
    const index = all.findIndex(page => page.id === dragId)
    const currentAfter = index > 0 ? all[index - 1].id : null
    if (target.afterId === currentAfter) return null
    if (target.afterId === undefined && all[all.length - 1].id === dragId) return null
  }
  return target
}
