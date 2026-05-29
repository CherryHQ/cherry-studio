import { describe, expect, it } from 'vitest'

import { KnowledgeSearchResultSchema } from '../knowledge'

describe('KnowledgeSearchResultSchema', () => {
  const result = {
    pageContent: 'hello',
    score: 0.9,
    scoreKind: 'relevance',
    rank: 1,
    metadata: {
      itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
      itemType: 'note',
      source: 'note-1',
      chunkIndex: 0,
      tokenCount: 1
    },
    itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
    chunkId: 'chunk-1'
  }

  it('accepts explicit chunk metadata', () => {
    expect(KnowledgeSearchResultSchema.parse(result)).toEqual(result)
  })

  it('rejects search results without required metadata fields', () => {
    const invalidResult = {
      ...result,
      metadata: {
        itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
        itemType: 'note',
        source: 'note-1',
        chunkIndex: 0
      }
    }

    expect(() => KnowledgeSearchResultSchema.parse(invalidResult)).toThrow()
  })
})
