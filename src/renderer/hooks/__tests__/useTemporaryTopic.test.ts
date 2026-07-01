import { dataApiService } from '@data/DataApiService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTemporaryTopic } from '../useTemporaryTopic'

describe('useTemporaryTopic', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === '/temporary/topics') return { id: 'temp-topic-1' } as never
      if (path === '/temporary/topics/temp-topic-1/persist') return undefined as never
      throw new Error(`Unexpected POST ${path}`)
    })
  })

  it('persists a seeded placeholder name as an automatic topic name', async () => {
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.persist(' Temporary title ')
    })

    expect(dataApiService.patch).toHaveBeenCalledWith('/topics/temp-topic-1', {
      body: {
        name: 'Temporary title',
        isNameManuallyEdited: false
      }
    })
  })
})
