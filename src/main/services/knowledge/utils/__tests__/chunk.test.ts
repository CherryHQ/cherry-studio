import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'
import { describe, expect, it } from 'vitest'

import { chunkDocuments } from '../chunk'

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: 1000,
    chunkOverlap: 0,
    searchMode: 'hybrid',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createItem() {
  return {
    id: 'item-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'note' as const,
    data: { source: 'item-1', content: 'hello' },
    status: 'idle' as const,
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('chunkDocuments', () => {
  it('returns an empty list when there are no source documents', () => {
    expect(chunkDocuments(createBase(), createItem(), [])).toEqual([])
  })

  it('preserves source metadata and annotates chunks with item metadata', () => {
    const documents = [
      new Document({
        text: 'hello world',
        metadata: { source: 'https://example.com/1' }
      }),
      new Document({
        text: 'goodbye world',
        metadata: { source: 'https://example.com/2' }
      })
    ]

    const chunks = chunkDocuments(createBase(), createItem(), documents)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.metadata).toMatchObject({
      source: 'https://example.com/1',
      itemId: 'item-1',
      itemType: 'note',
      chunkIndex: 0,
      tokenCount: expect.any(Number)
    })
    expect(chunks[1]?.metadata).toMatchObject({
      source: 'https://example.com/2',
      itemId: 'item-1',
      itemType: 'note',
      chunkIndex: 1,
      tokenCount: expect.any(Number)
    })
    expect(chunks[0]?.metadata.tokenCount).toBeGreaterThan(0)
  })
})
