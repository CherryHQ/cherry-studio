import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import { loadFileDocuments } from './KnowledgeFileReader'
import { loadSnapshotDocuments } from './KnowledgeSnapshotReader'

export type ReadableKnowledgeItem = KnowledgeItemOf<'file'> | KnowledgeItemOf<'url'> | KnowledgeItemOf<'note'>

export async function loadKnowledgeItemDocuments(item: ReadableKnowledgeItem): Promise<Document[]> {
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
