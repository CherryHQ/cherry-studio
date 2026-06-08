import { describe, expect, it, vi } from 'vitest'

import { searchWithCursor } from '../ftsSearch'

type TestSearchRow = {
  id: string
  createdAt: number
  searchableText: string
}

type TestSearchItem = {
  id: string
  createdAt: number
  snippet: string
}

describe('searchWithCursor', () => {
  it('uses caller-provided snippet construction', async () => {
    const fetchRows = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'message-1', createdAt: 100, searchableText: '**needle**' }])
      .mockResolvedValueOnce([])
    const buildSnippet = vi.fn(() => 'custom snippet')

    const result = await searchWithCursor<TestSearchRow, TestSearchItem, TestSearchItem>({
      q: 'needle',
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet,
      mapRow: (row, { snippet }) => ({
        id: row.id,
        createdAt: row.createdAt,
        snippet
      }),
      toPublicItem: (item) => item,
      getCursorCreatedAt: (item) => item.createdAt,
      getCursorId: (item) => item.id
    })

    expect(buildSnippet).toHaveBeenCalledWith('**needle**', ['needle'], 'substring')
    expect(result.items).toEqual([{ id: 'message-1', createdAt: 100, snippet: 'custom snippet' }])
  })

  it('rejects an empty raw cursor before fetching rows', async () => {
    const fetchRows = vi.fn(async () => [])

    await expect(
      searchWithCursor({
        q: 'needle',
        cursor: '',
        cursorConfig: {
          fieldMessage: 'must be a valid message cursor',
          errorMessage: 'Invalid message cursor'
        },
        fetchRows,
        getSearchableText: () => 'needle',
        buildSnippet: (text) => text,
        mapRow: () => ({
          id: 'message-1',
          createdAt: 100
        }),
        toPublicItem: (item) => item,
        getCursorCreatedAt: (item) => item.createdAt,
        getCursorId: (item) => item.id
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid message cursor'
    })

    expect(fetchRows).not.toHaveBeenCalled()
  })
})
