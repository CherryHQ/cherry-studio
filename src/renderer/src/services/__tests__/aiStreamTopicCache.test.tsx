import { cacheService } from '@data/CacheService'
import type { TopicStatusChangedPayload, TopicStreamStatus } from '@shared/ai/transport'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiStreamTopicCache } from '../aiStreamTopicCache'

type Handler = (payload: TopicStatusChangedPayload) => void

let capturedHandler: Handler | undefined
let getStatusesMock: ReturnType<typeof vi.fn<() => Promise<Record<string, TopicStreamStatus>>>>
let unsubscribeMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('cacheService', cacheService)
  // Start from a clean mock state so prior tests don't bleed keys across.
  ;(cacheService as unknown as { _resetMockState: () => void })._resetMockState()

  capturedHandler = undefined
  unsubscribeMock = vi.fn()
  getStatusesMock = vi.fn().mockResolvedValue({})

  vi.stubGlobal('window', {
    api: {
      ai: {
        topic: {
          getStatuses: getStatusesMock,
          onStatusChanged: (handler: Handler) => {
            capturedHandler = handler
            return unsubscribeMock
          }
        }
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAiStreamTopicCache', () => {
  it('populates the cache from the Main snapshot on mount', async () => {
    getStatusesMock.mockResolvedValue({ a: 'pending', b: 'streaming' })

    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })

    expect(cacheService.get('topic.stream.status.a')).toBe('pending')
    expect(cacheService.get('topic.stream.status.b')).toBe('streaming')
  })

  it('updates the cache on push deltas', async () => {
    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })

    expect(capturedHandler).toBeDefined()
    act(() => {
      capturedHandler!({ topicId: 'x', status: 'pending' })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('pending')

    act(() => {
      capturedHandler!({ topicId: 'x', status: 'streaming' })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('streaming')

    act(() => {
      capturedHandler!({ topicId: 'x', status: 'done' })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('done')
  })

  it('clears the cache key when the push delivers `idle`', async () => {
    getStatusesMock.mockResolvedValue({ x: 'done' })
    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('done')

    act(() => {
      capturedHandler!({ topicId: 'x', status: 'idle' })
    })
    // After `idle` the consumer should observe "no active stream" —
    // equivalent to the key being absent (we use undefined for the hook
    // mirror rather than hard-deleting, to stay compatible with
    // consumers that have an active `useCache` subscription on the key).
    expect(cacheService.get('topic.stream.status.x')).toBeUndefined()
  })

  it('unsubscribes on unmount', async () => {
    const hook = await act(async () => renderHook(() => useAiStreamTopicCache()))
    hook.unmount()
    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })
})
