/**
 * Process-local file retention for business owners that have not reached a
 * persistent FK-backed row yet (for example, messages in a temporary chat).
 *
 * The cleanup pass consults this registry both while discovering candidates
 * and immediately before deletion. Persistent owners must still write their
 * normal association rows; these holds only bridge the pre-persistence gap.
 */

const retainedBySource = new Map<string, Set<string>>()
const retainCounts = new Map<string, number>()

function decrement(fileEntryId: string): void {
  const next = (retainCounts.get(fileEntryId) ?? 0) - 1
  if (next > 0) retainCounts.set(fileEntryId, next)
  else retainCounts.delete(fileEntryId)
}

export function replaceTransientFileRetention(sourceId: string, fileEntryIds: readonly string[]): void {
  releaseTransientFileRetention(sourceId)

  const ids = new Set(fileEntryIds)
  if (ids.size === 0) return
  retainedBySource.set(sourceId, ids)
  for (const fileEntryId of ids) {
    retainCounts.set(fileEntryId, (retainCounts.get(fileEntryId) ?? 0) + 1)
  }
}

export function releaseTransientFileRetention(sourceId: string): void {
  const ids = retainedBySource.get(sourceId)
  if (!ids) return
  retainedBySource.delete(sourceId)
  for (const fileEntryId of ids) decrement(fileEntryId)
}

export function isFileEntryTransientlyRetained(fileEntryId: string): boolean {
  return retainCounts.has(fileEntryId)
}
