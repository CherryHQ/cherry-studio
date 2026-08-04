import type { NotesTreeNode } from '@renderer/types/note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { countOccurrences, searchAllFiles } from '../NotesSearchService'

const readExternal = vi.fn()

vi.stubGlobal('window', {
  api: { file: { readExternal: (path: string) => readExternal(path) } }
})

const createFile = (id: string, name: string): NotesTreeNode =>
  ({
    id,
    name,
    type: 'file',
    externalPath: `/notes/${id}.md`,
    updatedAt: new Date().toISOString()
  }) as NotesTreeNode

describe('countOccurrences', () => {
  it('counts every occurrence, not just the first', () => {
    expect(countOccurrences('人工智能与人工神经网络', '人工')).toBe(2)
  })

  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(countOccurrences('Proxy and proxy', 'proxy')).toBe(2)
    expect(countOccurrences('Proxy and proxy', 'proxy', { caseSensitive: true })).toBe(1)
  })

  it('treats the keyword literally unless useRegex is set', () => {
    expect(countOccurrences('a.b axb', 'a.b')).toBe(1)
    expect(countOccurrences('a.b axb', 'a.b', { useRegex: true })).toBe(2)
  })

  it('terminates on a regex keyword that can match empty', () => {
    // Without advancing lastIndex past a zero-length match this would spin forever.
    expect(countOccurrences('abc', 'x*', { useRegex: true })).toBe(4)
  })

  it('is zero when the keyword is absent', () => {
    expect(countOccurrences('nothing here', 'proxy')).toBe(0)
  })
})

describe('searchAllFiles', () => {
  beforeEach(() => {
    readExternal.mockReset()
  })

  it('reports a note matching in both places under both counts', async () => {
    // Regression: a 'both' note was folded into the content count but omitted from the
    // name count, so the sidebar showed "Name: 0" next to a "Name+Content" badge.
    readExternal.mockResolvedValue('抱歉，作为一个人工智能，我无法联网。\n再说一次，作为一个人工智能。')

    const results = await searchAllFiles([createFile('n1', '抱歉，作为一个人工智能，我无法联网')], '人工')

    expect(results).toHaveLength(1)
    expect(results[0].matchType).toBe('both')
    expect(results[0].nameMatchCount).toBe(1)
    expect(results[0].matches).toHaveLength(2)
  })

  it('counts every occurrence in a name, not just whether it matched', async () => {
    readExternal.mockResolvedValue('unrelated body')

    const results = await searchAllFiles([createFile('n1', '人工智能与人工神经网络')], '人工')

    expect(results[0].matchType).toBe('filename')
    expect(results[0].nameMatchCount).toBe(2)
  })

  it('reports a content-only match with a zero name count', async () => {
    readExternal.mockResolvedValue('the proxy timeout is configurable')

    const results = await searchAllFiles([createFile('n1', 'network notes')], 'proxy')

    expect(results[0].matchType).toBe('content')
    expect(results[0].nameMatchCount).toBe(0)
    expect(results[0].matches).toHaveLength(1)
  })

  it('records each occurrence separately so every hit can be listed', async () => {
    readExternal.mockResolvedValue('proxy one\nnothing\nproxy two and proxy three')

    const results = await searchAllFiles([createFile('n1', 'notes')], 'proxy')

    expect(results[0].matches?.map((match) => match.lineNumber)).toEqual([1, 3, 3])
  })

  it('windows a name whose hit sits past the row truncation point', async () => {
    // Regression: the full name was rendered and CSS-truncated, so a late hit was
    // clipped away and the row showed no highlight at all.
    readExternal.mockResolvedValue('unrelated body')
    const name = '抱歉，作为一个人工智能，我无法实时联网获取今天最新的天气情况'

    const results = await searchAllFiles([createFile('n1', name)], '天气')

    // Two characters of lead-in, then the rest of the name.
    expect(results[0].nameContext).toBe('...新的天气情况')
  })

  it('omits the leading ellipsis when the hit is already at the start', async () => {
    readExternal.mockResolvedValue('unrelated body')

    const results = await searchAllFiles([createFile('n1', 'proxy settings')], 'proxy')

    expect(results[0].nameContext).toBe('proxy settings')
  })

  it('leaves nameContext undefined for a content-only match', async () => {
    readExternal.mockResolvedValue('the proxy timeout')

    const results = await searchAllFiles([createFile('n1', 'network notes')], 'proxy')

    expect(results[0].nameContext).toBeUndefined()
  })

  it('keeps content match offsets pointing at the keyword inside the context', async () => {
    readExternal.mockResolvedValue('aaaaaaaaaaaaaaaaaaaa proxy tail')

    const results = await searchAllFiles([createFile('n1', 'notes')], 'proxy')
    const match = results[0].matches![0]

    expect(match.context.slice(match.matchStart, match.matchEnd)).toBe('proxy')
    expect(match.context.startsWith('...')).toBe(true)
  })

  it('orders matches so a per-line ordinal can be derived from them', async () => {
    // The sidebar sends the editor an ordinal scoped to one markdown line; that is only
    // derivable if `matches` stays in document order with a lineNumber on each.
    readExternal.mockResolvedValue('proxy one\nnothing\nproxy two and proxy three')

    const results = await searchAllFiles([createFile('n1', 'notes')], 'proxy')
    const matches = results[0].matches!

    expect(matches.map((m) => m.lineNumber)).toEqual([1, 3, 3])
    // Per-line ordinals derived the way NotesSearchMatchList derives them.
    const lineOrdinals = matches.map(
      (match, index) => matches.slice(0, index).filter((m) => m.lineNumber === match.lineNumber).length
    )
    expect(lineOrdinals).toEqual([0, 0, 1])
  })

  it('skips a note that matches neither name nor content', async () => {
    readExternal.mockResolvedValue('unrelated body')

    expect(await searchAllFiles([createFile('n1', 'unrelated name')], 'proxy')).toEqual([])
  })
})
