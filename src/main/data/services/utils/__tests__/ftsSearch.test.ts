import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
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
      .mockReturnValueOnce([{ id: 'message-1', createdAt: 100, searchableText: '**needle**' }])
      .mockReturnValueOnce([])
    const buildSnippet = vi.fn(() => 'custom snippet')

    const result = searchWithCursor<TestSearchRow, TestSearchItem>({
      q: 'needle',
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet,
      mapRow: (row, { snippet }) => ({
        item: {
          id: row.id,
          createdAt: row.createdAt,
          snippet
        },
        sort: {
          createdAt: row.createdAt,
          id: row.id
        }
      })
    })

    expect(buildSnippet).toHaveBeenCalledWith('**needle**', ['needle'], 'substring')
    expect(result.items).toEqual([{ id: 'message-1', createdAt: 100, snippet: 'custom snippet' }])
  })

  it('rejects an empty raw cursor before fetching rows', async () => {
    const fetchRows = vi.fn(() => [])

    let err: unknown
    try {
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
          item: {
            id: 'message-1',
            createdAt: 100,
            snippet: 'needle'
          },
          sort: {
            id: 'message-1',
            createdAt: 100
          }
        })
      })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid message cursor'
    })

    expect(fetchRows).not.toHaveBeenCalled()
  })

  it('continues scanning into a later chunk when the first candidates fail regex validation', async () => {
    const fetchRows = vi
      .fn()
      .mockReturnValueOnce([{ id: 'rejected-1', createdAt: 300, searchableText: 'haystack only' }])
      .mockReturnValueOnce([{ id: 'accepted-1', createdAt: 200, searchableText: 'needle appears here' }])
      .mockReturnValueOnce([])

    const result = searchWithCursor<TestSearchRow, TestSearchItem>({
      q: 'needle',
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet: (text) => text,
      mapRow: (row, { snippet }) => ({
        item: {
          id: row.id,
          createdAt: row.createdAt,
          snippet
        },
        sort: {
          createdAt: row.createdAt,
          id: row.id
        }
      })
    })

    expect(fetchRows.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(fetchRows.mock.calls.slice(0, 2).map(([context]) => context.offset)).toEqual([0, 1])
    expect(result.items).toEqual([{ id: 'accepted-1', createdAt: 200, snippet: 'needle appears here' }])
  })

  it('uses the last returned item as the next cursor boundary when limit plus one matches exist', async () => {
    const fetchRows = vi.fn().mockReturnValueOnce([
      { id: 'c', createdAt: 300, searchableText: 'needle newest' },
      { id: 'b', createdAt: 200, searchableText: 'needle middle' },
      { id: 'a', createdAt: 100, searchableText: 'needle oldest' }
    ])

    const result = searchWithCursor<TestSearchRow, TestSearchItem>({
      q: 'needle',
      limit: 2,
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet: (text) => text,
      mapRow: (row, { snippet }) => ({
        item: {
          id: row.id,
          createdAt: row.createdAt,
          snippet
        },
        sort: {
          createdAt: row.createdAt,
          id: row.id
        }
      })
    })

    expect(result.items.map((item) => item.id)).toEqual(['c', 'b'])
    expect(result.nextCursor).toBe('200:b')
  })

  it('passes undefined createdAtFromMs when createdAtFrom is not a valid date string', async () => {
    const fetchRows = vi.fn().mockReturnValueOnce([])

    searchWithCursor<TestSearchRow, TestSearchItem>({
      q: 'needle',
      createdAtFrom: 'today',
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet: (text) => text,
      mapRow: (row, { snippet }) => ({
        item: {
          id: row.id,
          createdAt: row.createdAt,
          snippet
        },
        sort: {
          createdAt: row.createdAt,
          id: row.id
        }
      })
    })

    expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ createdAtFromMs: undefined }))
  })

  it('stops scanning when the candidate ceiling is reached without enough regex-confirmed results', async () => {
    mockMainLoggerService.warn.mockClear()
    const fetchRows = vi.fn().mockReturnValueOnce([
      { id: 'rejected-1', createdAt: 300, searchableText: 'haystack one' },
      { id: 'rejected-2', createdAt: 200, searchableText: 'haystack two' }
    ])

    const result = searchWithCursor<TestSearchRow, TestSearchItem>({
      q: 'needle',
      maxCandidates: 2,
      cursorConfig: {
        fieldMessage: 'must be a valid search cursor',
        errorMessage: 'Invalid search cursor'
      },
      fetchRows,
      getSearchableText: (row) => row.searchableText,
      buildSnippet: (text) => text,
      mapRow: (row, { snippet }) => ({
        item: {
          id: row.id,
          createdAt: row.createdAt,
          snippet
        },
        sort: {
          createdAt: row.createdAt,
          id: row.id
        }
      })
    })

    expect(fetchRows).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ items: [], nextCursor: undefined })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('FTS search candidate scan limit reached', {
      scannedCandidates: 2,
      limit: 500,
      maxCandidates: 2,
      termCount: 1
    })
    expect(mockMainLoggerService.warn.mock.calls[0]?.[1]).not.toHaveProperty('query')
  })
})
