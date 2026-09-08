import { dataApiService } from '@data/DataApiService'
import { renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEntityReferenceMentionSource } from '../useEntityReferenceMentionSource'

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn() }
}))

describe('useEntityReferenceMentionSource', () => {
  beforeEach(() => {
    vi.mocked(dataApiService.get).mockReset()
  })

  it('keeps Note results available when conversation search fails', async () => {
    vi.mocked(dataApiService.get).mockRejectedValueOnce(new Error('topic search unavailable'))
    const noteItems = [
      {
        id: 'note-reference:/notes/Launch.md',
        label: 'Launch',
        command: vi.fn()
      }
    ]
    const getNoteItems = vi.fn().mockResolvedValue(noteItems)
    const { result } = renderHook(() =>
      useEntityReferenceMentionSource({
        entityType: 'topic',
        additionalItems: { getItems: getNoteItems, title: 'Notes' }
      })
    )

    const items = await result.current.sources[0].items({ query: 'launch', editor: {} as Editor })

    expect(items).toEqual(noteItems)
    expect(getNoteItems).toHaveBeenCalledWith({ query: 'launch', editor: expect.anything() })
  })
})
