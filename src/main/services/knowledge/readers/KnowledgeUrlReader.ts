import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument } from '@vectorstores/core'
import { net } from 'electron'

import type { KnowledgeReader } from './KnowledgeReader'

export class KnowledgeUrlReader implements KnowledgeReader<KnowledgeItemOf<'url'>> {
  async load(item: KnowledgeItemOf<'url'>): Promise<VectorStoreDocument[]> {
    const response = await net.fetch(`https://r.jina.ai/${item.data.url}`, {
      headers: {
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to read url ${item.data.url}: HTTP ${response.status}`)
    }

    const markdown = (await response.text()).trim()
    if (!markdown) {
      return []
    }

    return [
      new Document({
        text: markdown,
        metadata: {
          itemId: item.id,
          itemType: item.type,
          sourceUrl: item.data.url,
          name: item.data.name
        }
      })
    ]
  }
}
