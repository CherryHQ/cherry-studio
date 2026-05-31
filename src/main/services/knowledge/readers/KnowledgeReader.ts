import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import { loadFileDocuments } from './KnowledgeFileReader'
import { loadNoteDocuments } from './KnowledgeNoteReader'
import { loadUrlDocuments } from './KnowledgeUrlReader'

export type ReadableKnowledgeItem = KnowledgeItemOf<'file'> | KnowledgeItemOf<'url'> | KnowledgeItemOf<'note'>

export interface LoadKnowledgeItemDocumentsOptions {
  fileEntryId?: KnowledgeItemOf<'file'>['data']['fileEntryId']
}

export async function loadKnowledgeItemDocuments(
  item: ReadableKnowledgeItem,
  signal?: AbortSignal,
  options: LoadKnowledgeItemDocumentsOptions = {}
): Promise<Document[]> {
  if (item.type !== 'file' && options.fileEntryId !== undefined) {
    throw new Error(`fileEntryId override is only supported for file knowledge items: ${item.type}`)
  }

  switch (item.type) {
    case 'file':
      return await loadFileDocuments(item, options.fileEntryId ?? item.data.fileEntryId)
    case 'url':
      return await loadUrlDocuments(item, signal)
    case 'note':
      return await loadNoteDocuments(item)
    default:
      throw new Error(`Unsupported knowledge item type: ${(item as KnowledgeItem).type}`)
  }
}
