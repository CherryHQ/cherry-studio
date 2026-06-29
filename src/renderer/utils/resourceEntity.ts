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
