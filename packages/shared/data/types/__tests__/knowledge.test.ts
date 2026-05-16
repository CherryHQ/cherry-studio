import { describe, expect, it } from 'vitest'

import { isSupportedKnowledgeFileExt, KnowledgeSearchResultSchema } from '../knowledge'

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
  it.each(['.txt', '.md', '.markdown', 'pdf', '.docx', '.EPUB', '.csv', ' .json ', '.draftsExport'])(
    'classifies %s as supported',
    (ext) => {
      expect(isSupportedKnowledgeFileExt(ext)).toBe(true)
    }
  )

  it.each(['.exe', '.bin', '.sqlite', '.py', '.ts', '.log', '.tsv', '.jsonl', '.ndjson', '.png', '.mp3', '.zip', ''])(
    'classifies %s as unsupported',
    (ext) => {
      expect(isSupportedKnowledgeFileExt(ext)).toBe(false)
    }
  )
})
