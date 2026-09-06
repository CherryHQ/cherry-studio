import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import type { IndexableKnowledgeItem } from '../../items'

export async function loadKnowledgeItemDocuments(item: IndexableKnowledgeItem): Promise<Document[]> {
  switch (item.type) {
    case 'file': {
      const { loadFileDocuments } = await import('./KnowledgeFileReader')
      return await loadFileDocuments(item)
    }
    case 'url': {
      const { loadSnapshotDocuments } = await import('./KnowledgeSnapshotReader')
      return await loadSnapshotDocuments(item, 'URL')
    }
    case 'note': {
      const { loadSnapshotDocuments } = await import('./KnowledgeSnapshotReader')
      return await loadSnapshotDocuments(item, 'note')
    }
    default:
      throw new Error(`Unsupported knowledge item type: ${(item as KnowledgeItem).type}`)
  }
}
