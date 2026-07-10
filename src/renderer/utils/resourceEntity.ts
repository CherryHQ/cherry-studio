/**
 * A row's `createdAt` and `updatedAt` are each filled by an independent `Date.now()` default at
 * insert, so a brand-new row's two timestamps can straddle a millisecond boundary and differ by
 * ~1ms. Allow that much slack when deciding "untouched" so a freshly-created placeholder still
 * reads as reusable; any real activity bumps `updatedAt` by orders of magnitude more (a separate
 * write round-trip at minimum, user-driven activity by seconds), well outside this window.
 */
const UNTOUCHED_SINCE_CREATION_TOLERANCE_MS = 1

/**
 * A classic-layout placeholder is reusable only while it is *untouched* — its `updatedAt` has not
 * meaningfully moved past `createdAt`. This is a real emptiness signal, unlike a blank name: any
 * real activity (sending a message, a manual rename, an auto-title) bumps the row's `updatedAt`,
 * so an untouched row provably carries no messages even when auto-naming is off and the name stays
 * permanently blank. A blank-name test would treat such a chatted-in conversation as reusable and
 * silently reopen it instead of starting a new one.
 *
 * Both timestamps must be present; a row missing either is treated as touched (not reusable) so we
 * never reopen a row of unknown state. Unparseable timestamps fall back to exact string equality.
 */
export function isUntouchedSinceCreation(item: { createdAt?: string; updatedAt?: string }): boolean {
  if (item.createdAt === undefined || item.updatedAt === undefined) return false
  const createdAtMs = Date.parse(item.createdAt)
  const updatedAtMs = Date.parse(item.updatedAt)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(updatedAtMs)) {
    return item.updatedAt === item.createdAt
  }
  return Math.abs(updatedAtMs - createdAtMs) <= UNTOUCHED_SINCE_CREATION_TOLERANCE_MS
}

/**
 * Selection policy for "which row becomes active after the active one is deleted": pick the next
 * row in the given display-ordered list, or the previous row when the deleted row was last. Returns
 * `undefined` when `id` is not present or was the only row (callers decide the empty fallback).
 *
 * `orderedList` must be the list in *visible display order* (and scoped to the surface the deleted
 * row lived in), and must still contain the deleted row — call this on the pre-refresh snapshot.
 * Centralizes the topic and agent-session delete-selection so both surfaces stay consistent instead
 * of one picking the display neighbour and the other the raw API/orderKey head.
 */
export function pickNeighbourAfterRemoval<T extends { id: string }>(
  orderedList: readonly T[],
  id: string
): T | undefined {
  if (orderedList.length <= 1) return undefined
  const index = orderedList.findIndex((item) => item.id === id)
  if (index === -1) return undefined
  return orderedList[index + 1 === orderedList.length ? index - 1 : index + 1]
}

/**
 * Return the entity with the most recent `updatedAt` (ISO string). Ties keep the first item;
 * a missing or unparseable `updatedAt` sorts as oldest. Returns `undefined` for an empty list.
 */
export function findLatestUpdated<T extends { updatedAt?: string }>(items: readonly T[]): T | undefined {
  let latest: T | undefined
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY

  for (const item of items) {
    const parsedUpdatedAtMs = item.updatedAt ? Date.parse(item.updatedAt) : Number.NEGATIVE_INFINITY
    const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Number.NEGATIVE_INFINITY
    if (!latest || updatedAtMs > latestUpdatedAtMs) {
      latest = item
      latestUpdatedAtMs = updatedAtMs
    }
  }

  return latest
}
