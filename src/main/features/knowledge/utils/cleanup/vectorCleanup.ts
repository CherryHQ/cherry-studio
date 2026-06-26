import { application } from '@application'
import { loggerService } from '@logger'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('KnowledgeVectorCleanup')

export async function deleteKnowledgeItemVectors(base: KnowledgeBase, itemIds: string[]): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const store = await vectorStoreService.getIndexStoreIfExists(base)
  if (!store) {
    return
  }

  // Delete every id in ONE batched transaction with a single collectIndexGarbage pass.
  // The old per-id Promise.allSettled loop ran the two full-table GC scans once per item,
  // so deleting a folder of N files scanned the whole embedding/content table N times —
  // the multi-second main-process freeze on large (PDF-heavy) folders. deleteMaterials
  // rolls the whole batch back on failure (throwing the root cause), so a retry
  // re-discovers every affected id; no per-item failure aggregation is needed.
  await store.deleteMaterials(uniqueItemIds)
}

/**
 * Return the space a subtree delete freed in a base's index.sqlite to the OS.
 * Best-effort: the rows and vectors are already gone, so a reclaim failure (e.g. a
 * transient lock from a concurrent read) must never fail the delete job — it just
 * leaves the freed pages for a later index to reuse. Only VACUUMs when the freelist
 * crossed the driver's threshold (a large delete); otherwise it just truncates the WAL.
 */
export async function reclaimKnowledgeIndexSpace(base: KnowledgeBase): Promise<void> {
  try {
    // getIndexStoreIfExists itself can throw (a corrupt index, a readiness/base_id mismatch, a
    // schema open failure) — keep it inside the try so an open failure is best-effort just like a
    // reclaim failure, never failing the already-completed delete job.
    const store = await application.get('KnowledgeVectorStoreService').getIndexStoreIfExists(base)
    if (!store) {
      return
    }
    const { vacuumed, reclaimedBytes } = await store.reclaimSpace()
    if (vacuumed) {
      logger.info('Reclaimed knowledge index space after delete', { baseId: base.id, reclaimedBytes })
    }
  } catch (error) {
    logger.warn('Failed to reclaim knowledge index space after delete', error as Error, { baseId: base.id })
  }
}
