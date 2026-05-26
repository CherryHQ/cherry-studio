import { application } from '@application'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import type { FileEntryId } from '@shared/data/types/file'

export async function detachKnowledgeItemFileRefs(itemIds: string[]): Promise<number> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return 0
  }

  const refs = (
    await Promise.all(
      uniqueItemIds.map((sourceId) => fileRefService.findBySource({ sourceType: 'knowledge_item', sourceId }))
    )
  ).flat()
  const entryIds = [...new Set(refs.map((ref) => ref.fileEntryId))]

  const detachedCount = await fileRefService.cleanupBySourceBatch('knowledge_item', uniqueItemIds)
  await cleanupUnreferencedInternalEntries(entryIds)

  return detachedCount
}

async function cleanupUnreferencedInternalEntries(entryIds: FileEntryId[]): Promise<void> {
  if (entryIds.length === 0) {
    return
  }

  const refCounts = await fileRefService.countByEntryIds(entryIds)
  const fileManager = application.get('FileManager')

  await Promise.all(
    entryIds.map(async (entryId) => {
      if ((refCounts.get(entryId) ?? 0) > 0) {
        return
      }

      const entry = await fileEntryService.findById(entryId)
      if (!entry || entry.origin !== 'internal') {
        return
      }

      await fileManager.permanentDelete(entryId)
    })
  )
}
