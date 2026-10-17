/** Same-page writes, one lane per page, counted per kind.

An update and a favorite of one page share a tail so their requests never
interleave, but each kind only yields to a newer call of that same kind.
A favorite must not make an older update skip its repair, and the reverse.
*/

const RECENT_MUTATION_MS = 2000

export type PageMutationKind = 'update' | 'favorite'

interface Lane {
  tail: Promise<unknown>
  pending: Record<PageMutationKind, number>
  /** Monotonic per kind. A settle handler is stale when this has moved on. */
  generation: Record<PageMutationKind, number>
}

interface Activity {
  pending: number
  settledAt: number
  pruneTimer: ReturnType<typeof setTimeout> | undefined
}

const lanes = new Map<string, Lane>()
const activity = new Map<string, Activity>()

function activityOf(id: string): Activity {
  let current = activity.get(id)
  if (!current) {
    current = { pending: 0, settledAt: 0, pruneTimer: undefined }
    activity.set(id, current)
  }
  return current
}

/** Drops the entry once nothing is pending and the window has passed. */
function schedulePrune(id: string, current: Activity) {
  if (current.pruneTimer !== undefined) return
  current.pruneTimer = setTimeout(
    () => {
      current.pruneTimer = undefined
      if (current.pending > 0) return
      if (hasRecentPageMutation(id)) schedulePrune(id, current)
      else if (activity.get(id) === current) activity.delete(id)
    },
    Math.max(0, current.settledAt + RECENT_MUTATION_MS - Date.now())
  )
}

function laneOf(id: string): Lane {
  let lane = lanes.get(id)
  if (!lane) {
    lane = {
      tail: Promise.resolve(),
      pending: { update: 0, favorite: 0 },
      generation: { update: 0, favorite: 0 },
    }
    lanes.set(id, lane)
  }
  return lane
}

/** True when a later call of this kind has already claimed the page. */
export function isStalePageMutation(id: string, kind: PageMutationKind, seq: number): boolean {
  const lane = lanes.get(id)
  return lane === undefined || lane.generation[kind] !== seq
}

/**
 * True while this tab's mutation of the page is in flight, or settled within
 * the last 2s. The events hook skips this tab's own event for that page only
 * inside the window: a matching client id outside it is processed, so a
 * spoofed id cannot silence the tab.
 */
export function hasRecentPageMutation(id: string, now = Date.now()): boolean {
  const current = activity.get(id)
  if (!current) return false
  return current.pending > 0 || now - current.settledAt < RECENT_MUTATION_MS
}

/** Marks the page mutated for the life of `run`, then for {@link RECENT_MUTATION_MS}. */
export function trackPageMutation<T>(pageId: string, run: () => Promise<T>): Promise<T> {
  const current = activityOf(pageId)
  current.pending += 1
  return run().finally(() => {
    current.pending -= 1
    current.settledAt = Date.now()
    schedulePrune(pageId, current)
  })
}

/** Marks a change this tab made outside a mutation (a collab edit) as recent. */
export function notePageActivity(pageId: string) {
  const current = activityOf(pageId)
  current.settledAt = Date.now()
  schedulePrune(pageId, current)
}

/**
 * Runs one queued mutation. `run` receives the previous call's settle promise
 * and this call's sequence number. The sequence is internal: callers never
 * see `wait` or `seq`.
 */
export function runPageMutation<T>(
  id: string,
  kind: PageMutationKind,
  run: (wait: Promise<unknown>, seq: number) => Promise<T>
): Promise<T> {
  const lane = laneOf(id)
  lane.pending[kind] += 1
  lane.generation[kind] += 1
  const seq = lane.generation[kind]
  const wait = lane.tail
  const done = trackPageMutation(id, () => run(wait, seq))
  const settled = done.then(
    () => undefined,
    () => undefined
  )
  lane.tail = settled
  void settled.then(() => {
    lane.pending[kind] -= 1
    const current = lanes.get(id)
    if (
      current &&
      current.pending.update === 0 &&
      current.pending.favorite === 0 &&
      current.tail === settled
    ) {
      lanes.delete(id)
    }
  })
  return done
}
