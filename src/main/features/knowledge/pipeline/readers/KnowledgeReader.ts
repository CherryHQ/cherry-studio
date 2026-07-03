import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import type { IndexableKnowledgeItem } from '../../items'
import { loadFileDocuments } from './KnowledgeFileReader'
import { loadSnapshotDocuments } from './KnowledgeSnapshotReader'

export async function loadKnowledgeItemDocuments(item: IndexableKnowledgeItem): Promise<Document[]> {
  switch (item.type) {
    case 'file':
      return await loadFileDocuments(item)
    case 'url':
      return await loadSnapshotDocuments(item, 'URL')
    case 'note':
      return await loadSnapshotDocuments(item, 'note')
    default:
      throw new Error(`Unsupported knowledge item type: ${(item as KnowledgeItem).type}`)
  }
}
