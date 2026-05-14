import { describe, expect, it } from 'vitest'

import { isSupportedKnowledgeFileExt, isSupportedKnowledgeFileType, KnowledgeSearchResultSchema } from '../knowledge'

describe('KnowledgeSearchResultSchema', () => {
  const result = {
    pageContent: 'hello',
    score: 0.9,
    scoreKind: 'relevance',
    rank: 1,
    metadata: {
      itemId: 'item-1',
      itemType: 'note',
      source: 'note-1',
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
        chunkIndex: 0
      }
    }

    expect(() => KnowledgeSearchResultSchema.parse(invalidResult)).toThrow()
  })
})

describe('knowledge supported file helpers', () => {
  it('allows text and document file types', () => {
    expect(isSupportedKnowledgeFileType('text')).toBe(true)
    expect(isSupportedKnowledgeFileType('document')).toBe(true)
  })

  it('rejects non-text and non-document file types', () => {
    expect(isSupportedKnowledgeFileType('image')).toBe(false)
    expect(isSupportedKnowledgeFileType('audio')).toBe(false)
    expect(isSupportedKnowledgeFileType('video')).toBe(false)
    expect(isSupportedKnowledgeFileType('other')).toBe(false)
  })

  it('classifies extensions with the shared file type map', () => {
    expect(isSupportedKnowledgeFileExt('.md')).toBe(true)
    expect(isSupportedKnowledgeFileExt('pdf')).toBe(true)
    expect(isSupportedKnowledgeFileExt('.png')).toBe(false)
    expect(isSupportedKnowledgeFileExt('mp3')).toBe(false)
  })
})
