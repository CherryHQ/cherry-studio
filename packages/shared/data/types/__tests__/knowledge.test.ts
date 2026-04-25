import { describe, expect, it } from 'vitest'

import { KnowledgeSearchResultSchema } from '../knowledge'

describe('KnowledgeSearchResultSchema', () => {
  const result = {
    pageContent: 'hello',
    score: 0.9,
    metadata: {
      itemId: 'item-1',
      itemType: 'note',
      source: 'note-1',
      name: 'hello',
      chunkIndex: 0,
      tokenCount: 1
    },
    itemId: 'item-1',
    chunkId: 'chunk-1'
  }

  it('accepts explicit chunk metadata', () => {
    expect(KnowledgeSearchResultSchema.parse(result)).toEqual(result)
  })

  it('rejects search results without required metadata fields', () => {
    const invalidResult = {
      ...result,
      metadata: {
        itemId: 'item-1',
        itemType: 'note',
        source: 'note-1',
        name: 'hello',
        chunkIndex: 0
      }
    }

    expect(() => KnowledgeSearchResultSchema.parse(invalidResult)).toThrow()
  })
})
