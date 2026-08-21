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
    expect(dataApiService.post).toHaveBeenCalledWith('/temporary/topics/temp-topic-1/persist', {
      body: { discardFailedTurns: true }
    })
  })

  it('does not persist a lone surrogate when the placeholder name cut lands inside an emoji', async () => {
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.persist('字'.repeat(29) + '😀' + '文'.repeat(10))
    })

    expect(dataApiService.patch).toHaveBeenCalledWith('/topics/temp-topic-1', {
      body: {
        name: '字'.repeat(29),
        isNameManuallyEdited: false
      }
    })
  })

  it('does not delete a topic while its promotion is in flight', async () => {
    let finishPersist: (() => void) | undefined
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === '/temporary/topics') return { id: 'temp-topic-1' } as never
      if (path === '/temporary/topics/temp-topic-1/persist') {
        await new Promise<void>((resolve) => {
          finishPersist = resolve
        })
        return undefined as never
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    const { result, unmount } = renderHook(() => useTemporaryTopic({ enabled: true }))
    await waitFor(() => expect(result.current.ready).toBe(true))

    let persistence: Promise<void> | undefined
    act(() => {
      persistence = result.current.persist()
    })
    await waitFor(() => expect(finishPersist).toBeTypeOf('function'))

    unmount()
    expect(dataApiService.delete).not.toHaveBeenCalledWith('/temporary/topics/temp-topic-1')

    finishPersist!()
    await act(async () => persistence)
  })
})
