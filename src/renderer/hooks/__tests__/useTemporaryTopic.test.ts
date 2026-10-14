import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'

import { useTemporaryTopic } from '../useTemporaryTopic'

describe('useTemporaryTopic', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route) => {
      if (route === 'ai.temporary_chat.create') return { id: 'temp-topic-1' } as never
      if (route === 'ai.temporary_chat.persist' || route === 'ai.temporary_chat.delete') return undefined as never
      throw new Error(`Unexpected route ${route}`)
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
  it('does not discard a promoted topic when its view unmounts', async () => {
    const { result, unmount } = renderHook(() => useTemporaryTopic({ enabled: true }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      await result.current.persist()
    })
    vi.mocked(ipcApi.request).mockClear()
    unmount()
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.temporary_chat.delete', expect.anything())
  })

  it('discards a late creation without replacing ownership of a newer topic', async () => {
    const oldCreation = Promise.withResolvers<{ id: string }>()
    vi.mocked(ipcApi.request).mockImplementationOnce(() => oldCreation.promise as never)
    const { result, unmount } = renderHook(() => useTemporaryTopic({ enabled: true }))
    act(() => result.current.reset())
    await waitFor(() => expect(result.current.topicId).toBe('temp-topic-1'))
    await act(async () => {
      oldCreation.resolve({ id: 'old-topic' })
    })
    expect(result.current.topicId).toBe('temp-topic-1')
    expect(ipcApi.request).toHaveBeenCalledWith('ai.temporary_chat.delete', { topicId: 'old-topic' })
    unmount()
    expect(ipcApi.request).toHaveBeenCalledWith('ai.temporary_chat.delete', { topicId: 'temp-topic-1' })
  })
})
