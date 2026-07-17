/**
 * A classic-layout placeholder is reusable only while it has no conversation activity. The
 * persisted activity invariant makes that test exact: a session without user/assistant messages
 * has `lastActivityAt === createdAt`, while message start/completion advances `lastActivityAt`.
 * Metadata-only writes such as rename intentionally do not affect this decision.
 *
 * Both timestamps must be present; a row missing either is treated as touched (not reusable) so we
 * never reopen a row of unknown state.
 */
export function isUntouchedSinceCreation(item: { createdAt?: string; lastActivityAt?: string }): boolean {
  return item.createdAt !== undefined && item.lastActivityAt !== undefined && item.lastActivityAt === item.createdAt
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
 * Return the entity with the most recent `createdAt` (ISO string). Ties keep the first item;
 * a missing or unparseable `createdAt` sorts as oldest. Returns `undefined` for an empty list.
 */
export function findLatestCreated<T extends { createdAt?: string }>(items: readonly T[]): T | undefined {
  let latest: T | undefined
  let latestCreatedAtMs = Number.NEGATIVE_INFINITY

  for (const item of items) {
    const parsedCreatedAtMs = item.createdAt ? Date.parse(item.createdAt) : Number.NEGATIVE_INFINITY
    const createdAtMs = Number.isFinite(parsedCreatedAtMs) ? parsedCreatedAtMs : Number.NEGATIVE_INFINITY
    if (!latest || createdAtMs > latestCreatedAtMs) {
      latest = item
      latestCreatedAtMs = createdAtMs
    }
  }

  return latest
}
