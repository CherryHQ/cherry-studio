import { application } from '@application'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

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
