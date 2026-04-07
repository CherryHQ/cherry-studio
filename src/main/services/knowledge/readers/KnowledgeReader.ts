import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import { loadDirectoryDocuments } from './KnowledgeDirectoryReader'
import { loadFileDocuments } from './KnowledgeFileReader'
import { loadNoteDocuments } from './KnowledgeNoteReader'
import { loadSitemapDocuments } from './KnowledgeSitemapReader'
import { loadUrlDocuments } from './KnowledgeUrlReader'

export async function loadKnowledgeItemDocuments(item: KnowledgeItem): Promise<Document[]> {
  switch (item.type) {
    case 'file':
      return await loadFileDocuments(item)
    case 'url':
      return await loadUrlDocuments(item)
    case 'note':
      return await loadNoteDocuments(item)
    case 'sitemap':
      return await loadSitemapDocuments(item)
    case 'directory':
      return await loadDirectoryDocuments(item)
  }
}
