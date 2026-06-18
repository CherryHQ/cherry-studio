import { describe, expect, it } from 'vitest'

import {
  getKnowledgeItemConflictKey,
  getKnowledgeItemDisplayTitle,
  getKnowledgeNoteFirstLine,
  getKnowledgePathBasename,
  KnowledgeSearchResultSchema
} from '../knowledge'

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

describe('getKnowledgePathBasename', () => {
  it('returns the last path segment for posix and windows separators', () => {
    expect(getKnowledgePathBasename('/Users/me/docs/report.pdf')).toBe('report.pdf')
    expect(getKnowledgePathBasename('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
  })

  it('strips trailing separators and falls back to the input', () => {
    expect(getKnowledgePathBasename('/Users/me/projects/downloads/')).toBe('downloads')
    expect(getKnowledgePathBasename('plain-name')).toBe('plain-name')
  })
})

describe('getKnowledgeNoteFirstLine', () => {
  it('returns the first non-empty trimmed line', () => {
    expect(getKnowledgeNoteFirstLine('\n  \n  Meeting notes  \nbody')).toBe('Meeting notes')
    expect(getKnowledgeNoteFirstLine('')).toBe('')
  })
})

describe('getKnowledgeItemDisplayTitle', () => {
  it('prefers the deduped relativePath basename for file items, else the source basename', () => {
    // The deduped stored name keeps "保留全部" copies distinguishable in the list.
    expect(
      getKnowledgeItemDisplayTitle({ type: 'file', data: { source: '/a/b/测试.pdf', relativePath: '测试_2.pdf' } })
    ).toBe('测试_2.pdf')
    expect(getKnowledgeItemDisplayTitle({ type: 'file', data: { source: '/a/b/report.pdf' } })).toBe('report.pdf')
  })

  it('prefers the deduped relativePath basename for directory items, else the source basename', () => {
    // The deduped `raw/` directory name (e.g. `docs_2`) keeps same-named folders distinct in the list.
    expect(
      getKnowledgeItemDisplayTitle({ type: 'directory', data: { source: '/a/b/docs', relativePath: 'docs_2' } })
    ).toBe('docs_2')
    expect(getKnowledgeItemDisplayTitle({ type: 'directory', data: { source: '/a/b/docs' } })).toBe('docs')
  })

  it('prefers the captured snapshot name for note items, else the first content line', () => {
    expect(
      getKnowledgeItemDisplayTitle({ type: 'note', data: { content: 'Title\nbody', relativePath: 'Title_2.md' } })
    ).toBe('Title_2')
    expect(getKnowledgeItemDisplayTitle({ type: 'note', data: { content: 'Title\nbody' } })).toBe('Title')
  })

  it('prefers the captured snapshot name over the raw url, else falls back to the url', () => {
    expect(
      getKnowledgeItemDisplayTitle({ type: 'url', data: { url: 'https://x.com', relativePath: 'Page Title.md' } })
    ).toBe('Page Title')
    expect(getKnowledgeItemDisplayTitle({ type: 'url', data: { source: 'https://x.com', url: 'https://x.com' } })).toBe(
      'https://x.com'
    )
  })
})

describe('getKnowledgeItemConflictKey', () => {
  it('keys file and directory off the deduped relativePath, falling back to the source basename', () => {
    // An add-input has no relativePath yet → source basename, so detection still fires.
    expect(getKnowledgeItemConflictKey({ type: 'file', data: { source: '/a/report.pdf' } })).toBe('report.pdf')
    expect(getKnowledgeItemConflictKey({ type: 'directory', data: { source: '/a/docs' } })).toBe('docs')
    // An existing item keys off its deduped relativePath, so `replace` can target a
    // single copy among same-source-basename siblings (test.md vs test_2.md).
    expect(
      getKnowledgeItemConflictKey({ type: 'file', data: { source: '/a/test.md', relativePath: 'test_2.md' } })
    ).toBe('test_2.md')
    expect(
      getKnowledgeItemConflictKey({ type: 'directory', data: { source: '/a/docs', relativePath: 'docs_2' } })
    ).toBe('docs_2')
  })

  it('keys note off the first line', () => {
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { content: 'Title\nbody' } })).toBe('Title')
  })

  it('keys url off the raw url, ignoring any captured snapshot name', () => {
    // Detection must match real duplicate urls even after one side captured a snapshot
    // whose display title diverges from the url.
    expect(
      getKnowledgeItemConflictKey({ type: 'url', data: { url: 'https://x.com', relativePath: 'Page Title.md' } })
    ).toBe('https://x.com')
  })
})
