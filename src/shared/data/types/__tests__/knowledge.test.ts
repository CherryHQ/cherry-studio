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

  it('prefers the captured snapshot name for note items, then the title, else the first content line', () => {
    expect(
      getKnowledgeItemDisplayTitle({ type: 'note', data: { content: 'Title\nbody', relativePath: 'Title_2.md' } })
    ).toBe('Title_2')
    // Before the first index there is no snapshot yet, so the user's title stands in — otherwise the
    // row would show the body's first line and then visibly flip once indexing lands.
    expect(getKnowledgeItemDisplayTitle({ type: 'note', data: { source: 'Alpha', content: 'Shared\nbody' } })).toBe(
      'Alpha'
    )
    expect(getKnowledgeItemDisplayTitle({ type: 'note', data: { content: 'Title\nbody' } })).toBe('Title')
  })

  it("does not render a migrated note's whole body as its title", () => {
    // The v1 migrator sets `source = content` for legacy notes with no sourceUrl, so the title has
    // to be read a line at a time or the row (and kb_search results) show the entire note.
    const content = 'Meeting notes\n\n- item one\n- item two'
    expect(getKnowledgeItemDisplayTitle({ type: 'note', data: { source: content, content } })).toBe('Meeting notes')
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

  it('keys note off the same name it displays, so replace cannot purge a differently-titled note', () => {
    // Two notes the user gave distinct titles must not collide just because their bodies open with
    // the same line — `replace` would delete the existing one, content and all.
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Alpha', content: 'Shared\nbody1' } })).toBe(
      'Alpha'
    )
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Beta', content: 'Shared\nbody2' } })).toBe(
      'Beta'
    )
    // ...and the converse: one title, differing first lines, still collides.
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Alpha', content: 'one\nbody' } })).toBe('Alpha')
    // An existing note keys off its deduped snapshot name, so replace targets a single copy.
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Alpha', relativePath: 'Alpha_2.md' } })).toBe(
      'Alpha_2'
    )
    // Untitled notes still fall back to the first line.
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { content: 'Title\nbody' } })).toBe('Title')
  })

  it('normalizes a raw note title to the snapshot slug an indexed note is stored under', () => {
    // `Q4: plan` is captured as `Q4_ plan.md`, so keying the add-input off the raw title would miss
    // the re-add of any ordinary title containing a character sanitizeFilename rewrites.
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Q4: plan', content: 'draft' } })).toBe(
      'Q4_ plan'
    )
    expect(
      getKnowledgeItemConflictKey({ type: 'note', data: { source: 'Q4: plan', relativePath: 'Q4_ plan.md' } })
    ).toBe('Q4_ plan')
  })

  it('keeps an unnamed note on the empty key so detection skips it', () => {
    expect(getKnowledgeItemConflictKey({ type: 'note', data: { source: '', content: '' } })).toBe('')
  })

  it('keys url off the raw url, ignoring any captured snapshot name', () => {
    // Detection must match real duplicate urls even after one side captured a snapshot
    // whose display title diverges from the url.
    expect(
      getKnowledgeItemConflictKey({ type: 'url', data: { url: 'https://x.com', relativePath: 'Page Title.md' } })
    ).toBe('https://x.com')
  })
})
