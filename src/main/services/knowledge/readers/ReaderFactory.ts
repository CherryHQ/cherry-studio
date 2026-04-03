import type { KnowledgeItem, KnowledgeItemType } from '@shared/data/types/knowledge'

import { KnowledgeFileReader } from './KnowledgeFileReader'
import { KnowledgeNoteReader } from './KnowledgeNoteReader'
import type { KnowledgeReader } from './KnowledgeReader'
import { KnowledgeSitemapReader } from './KnowledgeSitemapReader'
import { KnowledgeUrlReader } from './KnowledgeUrlReader'

type ReadableKnowledgeItemType = Exclude<KnowledgeItemType, 'directory'>
type ReaderRegistration = () => KnowledgeReader<any>

export class ReaderFactory {
  static create(item: KnowledgeItem): KnowledgeReader {
    if (item.type === 'directory') {
      throw new Error('Directory items must be expanded before reading')
    }

    const registry: Record<ReadableKnowledgeItemType, ReaderRegistration> = {
      file: () => new KnowledgeFileReader(),
      note: () => new KnowledgeNoteReader(),
      url: () => new KnowledgeUrlReader(),
      sitemap: () => new KnowledgeSitemapReader()
    }

    return registry[item.type]()
  }
}
