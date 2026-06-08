import { describe, expect, it, vi } from 'vitest'

import { searchMessagesWithCursor } from '../messageSearch'

describe('searchMessagesWithCursor', () => {
  it('rejects an empty raw cursor before fetching rows', async () => {
    const fetchRows = vi.fn(async () => [])

    await expect(
      searchMessagesWithCursor({
        q: 'needle',
        cursor: '',
        cursorConfig: {
          fieldMessage: 'must be a valid message cursor',
          errorMessage: 'Invalid message cursor'
        },
        fetchRows,
        getSearchableText: () => 'needle',
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
