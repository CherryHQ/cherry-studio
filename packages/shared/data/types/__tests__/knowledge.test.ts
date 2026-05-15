import { describe, expect, it } from 'vitest'

import {
  isUnsupportedKnowledgeFileExt,
  KNOWLEDGE_UNSUPPORTED_FILE_EXTS,
  KnowledgeSearchResultSchema
} from '../knowledge'

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

describe('knowledge unsupported file helpers', () => {
  it('exposes the explicit knowledge unsupported extension list', () => {
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.png')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.mp3')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.mp4')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.zip')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.rar')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.7z')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.tar')
    expect(KNOWLEDGE_UNSUPPORTED_FILE_EXTS).toContain('.gz')
  })

  it('classifies extensions with the knowledge blocklist', () => {
    expect(isUnsupportedKnowledgeFileExt('.md')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt('pdf')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt('.EPUB')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt(' .EPUB ')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt('.draftsExport')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt('draftsExport')).toBe(false)
    expect(isUnsupportedKnowledgeFileExt('.png')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt('mp3')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt('.mp3')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt('.zip')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt(' RAR ')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt(' .RAR ')).toBe(true)
    expect(isUnsupportedKnowledgeFileExt('')).toBe(true)
  })
})
