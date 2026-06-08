import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import { loadFileDocuments } from './KnowledgeFileReader'
import { loadNoteDocuments } from './KnowledgeNoteReader'
import { loadUrlDocuments } from './KnowledgeUrlReader'

export type ReadableKnowledgeItem = KnowledgeItemOf<'file'> | KnowledgeItemOf<'url'> | KnowledgeItemOf<'note'>

export async function loadKnowledgeItemDocuments(
  item: ReadableKnowledgeItem,
  signal?: AbortSignal
): Promise<Document[]> {
  switch (item.type) {
    case 'file':
      return await loadFileDocuments(item)
    case 'url':
      return await loadUrlDocuments(item, signal)
    case 'note':
      return await loadNoteDocuments(item)
    default:
      throw new Error(`Unsupported knowledge item type: ${(item as KnowledgeItem).type}`)
  }
}
