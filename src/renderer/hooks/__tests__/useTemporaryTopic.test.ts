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
      if (path === '/temporary/topics/temp-topic-1/persist') {
        return { topicId: 'temp-topic-1', messageCount: 2, messageIds: ['message-1', 'message-2'] } as never
      }
      throw new Error(`Unexpected POST ${path}`)
    })
  })

  it('seeds a surrogate-safe title from the selected text first line when leasing', async () => {
    const initialName = `${'字'.repeat(29)}😀more\nignored second line`
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true, assistantId: 'assistant-1', initialName }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(dataApiService.post).toHaveBeenCalledWith('/temporary/topics', {
      body: {
        assistantId: 'assistant-1',
        name: '字'.repeat(29)
      }
    })
  })

  it('persists a seeded placeholder name as an automatic topic name', async () => {
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.persist({ initialName: ' Temporary title ' })
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
      await result.current.persist({ initialName: '字'.repeat(29) + '😀' + '文'.repeat(10) })
    })

    expect(dataApiService.patch).toHaveBeenCalledWith('/topics/temp-topic-1', {
      body: {
        name: '字'.repeat(29),
        isNameManuallyEdited: false
      }
    })
  })

  it('forwards an aggregate target and skips same-id placeholder patching', async () => {
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === '/temporary/topics') return { id: 'temp-topic-1' } as never
      if (path === '/temporary/topics/temp-topic-1/persist') {
        return { topicId: 'aggregate-topic-1', messageCount: 2, messageIds: ['message-1', 'message-2'] } as never
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    const { result } = renderHook(() => useTemporaryTopic({ enabled: true, assistantId: 'assistant-1' }))

    await waitFor(() => expect(result.current.ready).toBe(true))

    let persisted: Awaited<ReturnType<typeof result.current.persist>>
    await act(async () => {
      persisted = await result.current.persist({
        initialName: 'Ignored placeholder',
        aggregate: { key: 'selection-action:refine', name: 'Refine' }
      })
    })

    expect(dataApiService.post).toHaveBeenCalledWith('/temporary/topics/temp-topic-1/persist', {
      body: {
        aggregate: { key: 'selection-action:refine', name: 'Refine' }
      }
    })
    expect(dataApiService.patch).not.toHaveBeenCalled()
    expect(persisted!).toEqual({
      topicId: 'aggregate-topic-1',
      messageCount: 2,
      messageIds: ['message-1', 'message-2']
    })
  })
})
