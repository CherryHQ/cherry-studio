/**
 * Follow-up queue cross-window merge for the `ui.composer.followup_queue` persist key.
 *
 * This module owns the per-conversation reconciliation policy so `CacheService`
 * stays generic. The service delegates to `mergeFollowupQueues` via a narrow
 * per-key hook; when more keys need custom merging, promote this to a
 * `PersistMergeRegistry` (key → mergeFn) instead of adding more `if (key === ...)` branches.
 *
 * Snapshot limits (accepted tradeoffs, not bugs to re-report): both sides merge
 * whole-map snapshots with no versions or vector clocks, so a stale snapshot can
 * still win over a fresher one — e.g. a null tombstone broadcast from a window
 * that had not yet seen a concurrent enqueue deletes an entry the other window
 * just created. Within one conversation the merge unions by id (a same-scope
 * snapshot missing an item may predate that item's enqueue), so only a clear-all
 * — empty items or the null tombstone — propagates as a deletion; an individual
 * removal racing a stale snapshot can resurrect. Per-item tombstones or
 * versioning would make this causally safe; until then the policy prefers never
 * losing a queued message over never resurrecting a removed one.
 */

export function mergeFollowupQueues(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing }
  for (const [convKey, incomingVal] of Object.entries(incoming)) {
    if (incomingVal === null) {
      delete merged[convKey]
      continue
    }

    const existingVal = merged[convKey]

    if (existingVal === null) {
      const incomingEntry = incomingVal as { items?: unknown }
      if (Array.isArray(incomingEntry?.items) && incomingEntry.items.length > 0) {
        merged[convKey] = incomingVal
      }
      continue
    }

    if (
      existingVal &&
      typeof existingVal === 'object' &&
      !Array.isArray(existingVal) &&
      incomingVal &&
      typeof incomingVal === 'object' &&
      !Array.isArray(incomingVal)
    ) {
      const existingEntry = existingVal as { items?: unknown; paused?: unknown; failedItemId?: unknown }
      const incomingEntry = incomingVal as { items?: unknown; paused?: unknown; failedItemId?: unknown }
      if (Array.isArray(existingEntry.items) && Array.isArray(incomingEntry.items)) {
        const pausedMerged = existingEntry.paused === true || incomingEntry.paused === true
        const existingFailedId = typeof existingEntry.failedItemId === 'string' ? existingEntry.failedItemId : undefined
        const incomingFailedId = typeof incomingEntry.failedItemId === 'string' ? incomingEntry.failedItemId : undefined
        const existingItems = existingEntry.items as Array<{ id?: string }>
        const incomingItems = incomingEntry.items as Array<{ id?: string }>
        const existingIds = new Set(
          existingItems.filter((it): it is { id: string } => !!it && typeof it.id === 'string').map((it) => it.id)
        )
        const incomingIds = new Set(
          incomingItems.filter((it): it is { id: string } => !!it && typeof it.id === 'string').map((it) => it.id)
        )
        const newIdsInIncoming = [...incomingIds].filter((id) => !existingIds.has(id))
        const missingIds = [...existingIds].filter((id) => !incomingIds.has(id))
        const hasNewEnqueue = newIdsInIncoming.length > 0
        const hasDeletion = missingIds.length > 0
        if (hasNewEnqueue) {
          const byId = new Map<string, unknown>()
          for (const it of existingItems) {
            if (it && typeof it.id === 'string') byId.set(it.id, it)
          }
          for (const it of incomingItems) {
            if (it && typeof it.id === 'string' && !byId.has(it.id)) byId.set(it.id, it)
          }
          if (hasDeletion) {
            for (const delId of missingIds) {
              byId.delete(delId)
            }
          }
          const mergedItems = Array.from(byId.values()) as Array<{ id?: string }>
          const mergedFailedId = mergedItems.some((it) => it.id === existingFailedId)
            ? existingFailedId
            : mergedItems.some((it) => it.id === incomingFailedId)
              ? incomingFailedId
              : undefined
          merged[convKey] = {
            ...incomingEntry,
            paused: pausedMerged,
            items: mergedItems,
            ...(mergedFailedId ? { failedItemId: mergedFailedId } : {})
          }
        } else if (hasDeletion) {
          if (incomingItems.length === 0) {
            const failedIdToKeep = incomingItems.some((it) => it.id === incomingFailedId)
              ? incomingFailedId
              : incomingItems.some((it) => it.id === existingFailedId)
                ? existingFailedId
                : undefined
            merged[convKey] = {
              ...incomingEntry,
              paused: pausedMerged,
              items: incomingItems,
              ...(failedIdToKeep ? { failedItemId: failedIdToKeep } : {})
            }
          } else {
            const byId = new Map<string, unknown>()
            for (const it of existingItems) {
              if (it && typeof it.id === 'string') byId.set(it.id, it)
            }
            for (const it of incomingItems) {
              if (it && typeof it.id === 'string' && !byId.has(it.id)) byId.set(it.id, it)
            }
            const mergedItems = Array.from(byId.values()) as Array<{ id?: string }>
            const mergedFailedId = mergedItems.some((it) => it.id === existingFailedId)
              ? existingFailedId
              : mergedItems.some((it) => it.id === incomingFailedId)
                ? incomingFailedId
                : undefined
            merged[convKey] = {
              ...incomingEntry,
              paused: pausedMerged,
              items: mergedItems,
              ...(mergedFailedId ? { failedItemId: mergedFailedId } : {})
            }
          }
        } else {
          const failedIdToKeep = incomingItems.some((it) => it.id === incomingFailedId)
            ? incomingFailedId
            : incomingItems.some((it) => it.id === existingFailedId)
              ? existingFailedId
              : undefined
          merged[convKey] = {
            ...incomingEntry,
            paused: pausedMerged,
            items: incomingItems,
            ...(failedIdToKeep ? { failedItemId: failedIdToKeep } : {})
          }
        }
        continue
      }
    }

    merged[convKey] = incomingVal
  }
  return merged
}
