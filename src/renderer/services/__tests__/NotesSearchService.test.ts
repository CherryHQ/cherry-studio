import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotesTreeNode } from '@shared/types/note'

import { searchFileContent } from '../NotesSearchService'

const readExternal = vi.fn()

const node = (name: string): NotesTreeNode => ({
  id: name,
  name,
  type: 'file',
  treePath: `${name}.md`,
  externalPath: `/notes/${name}.md`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('searchFileContent', () => {
  beforeEach(() => {
    readExternal.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { file: { readExternal } }
    })
  })

  it('finds a literal keyword on every line', async () => {
    readExternal.mockResolvedValue('alpha beta\ngamma beta')

    const result = await searchFileContent(node('note'), 'beta')

    expect(result?.matches?.map((match) => match.lineNumber)).toEqual([1, 2])
  })

  it('does not fill the result list with zero-width matches', async () => {
    readExternal.mockResolvedValue('alpha\nbeta\ngamma')

    const result = await searchFileContent(node('note'), '.*', { useRegex: true })

    // One match per line, not fifty empty hits at the end of the first line.
    expect(result?.matches).toHaveLength(3)
    expect(result?.matches?.map((match) => match.lineNumber)).toEqual([1, 2, 3])
    expect(result?.matches?.every((match) => match.matchEnd > 0)).toBe(true)
  })

  it('returns no result when the pattern can only match an empty string', async () => {
    readExternal.mockResolvedValue('alpha\nbeta')

    const result = await searchFileContent(node('note'), '^', { useRegex: true })

    expect(result).toBeNull()
  })

  it('advances past an empty match in the middle of a line', async () => {
    readExternal.mockResolvedValue('ba')

    const result = await searchFileContent(node('note'), 'a*', { useRegex: true })

    expect(result?.matches).toHaveLength(1)
    expect(result?.matches?.[0].matchStart).toBe(1)
  })
})
