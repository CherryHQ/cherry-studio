/**
 * A classic-layout placeholder is reusable only while it is *untouched* — its `updatedAt`
 * still equals `createdAt`. This is a real emptiness signal, unlike a blank name: any real
 * activity (sending a message, a manual rename, an auto-title) bumps the row's `updatedAt`,
 * so an `updatedAt === createdAt` row provably carries no messages even when auto-naming is
 * off and the name stays permanently blank. A blank-name test would treat such a chatted-in
 * conversation as reusable and silently reopen it instead of starting a new one.
 *
 * Both timestamps must be present and identical; a row missing either is treated as touched
 * (not reusable) so we never reopen a row of unknown state.
 */
export function isUntouchedSinceCreation(item: { createdAt?: string; updatedAt?: string }): boolean {
  return item.createdAt !== undefined && item.updatedAt === item.createdAt
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
