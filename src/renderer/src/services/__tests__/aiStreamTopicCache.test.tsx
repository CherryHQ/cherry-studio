import { cacheService } from '@data/CacheService'
import type { TopicStatusChangedPayload, TopicStatusSnapshotEntry } from '@shared/ai/transport'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiStreamTopicCache } from '../aiStreamTopicCache'

type Handler = (payload: TopicStatusChangedPayload) => void

let capturedHandler: Handler | undefined
let getStatusesMock: ReturnType<typeof vi.fn<() => Promise<Record<string, TopicStatusSnapshotEntry>>>>
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
    getStatusesMock.mockResolvedValue({
      a: { status: 'pending', activeExecutionIds: [] },
      b: { status: 'streaming', activeExecutionIds: ['openai::gpt-4o'] }
    })

    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })

    expect(cacheService.get('topic.stream.status.a')).toBe('pending')
    expect(cacheService.get('topic.stream.executions.a')).toBeUndefined()
    expect(cacheService.get('topic.stream.status.b')).toBe('streaming')
    expect(cacheService.get('topic.stream.executions.b')).toEqual(['openai::gpt-4o'])
  })

  it('updates the cache on push deltas', async () => {
    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })

    expect(capturedHandler).toBeDefined()
    act(() => {
      capturedHandler!({ topicId: 'x', status: 'pending', activeExecutionIds: [] })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('pending')
    expect(cacheService.get('topic.stream.executions.x')).toBeUndefined()

    act(() => {
      capturedHandler!({ topicId: 'x', status: 'streaming', activeExecutionIds: ['openai::gpt-4o'] })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('streaming')
    expect(cacheService.get('topic.stream.executions.x')).toEqual(['openai::gpt-4o'])

    act(() => {
      capturedHandler!({ topicId: 'x', status: 'done', activeExecutionIds: [] })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('done')
    expect(cacheService.get('topic.stream.executions.x')).toBeUndefined()
  })

  it('retains the terminal status — Main never broadcasts a reap signal', async () => {
    getStatusesMock.mockResolvedValue({
      x: { status: 'done', activeExecutionIds: [] }
    })
    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('done')

    // No further delta arrives after grace-period reap on Main — the
    // cache mirror intentionally keeps the `done` badge visible until a
    // local consumer (e.g. active-topic `useEffect`) evicts it.
    expect(cacheService.get('topic.stream.status.x')).toBe('done')
  })

  it('unsubscribes on unmount', async () => {
    const hook = await act(async () => renderHook(() => useAiStreamTopicCache()))
    hook.unmount()
    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })

  it('ignores snapshot entries already overwritten by a faster delta', async () => {
    // Deferred snapshot: resolve only after the delta has landed.
    let resolveSnapshot: (v: Record<string, TopicStatusSnapshotEntry>) => void = () => {}
    getStatusesMock.mockImplementation(
      () =>
        new Promise<Record<string, TopicStatusSnapshotEntry>>((resolve) => {
          resolveSnapshot = resolve
        })
    )

    await act(async () => {
      renderHook(() => useAiStreamTopicCache())
    })

    // Delta wins the race — onStatusChanged fires while snapshot is pending.
    act(() => {
      capturedHandler!({ topicId: 'x', status: 'done', activeExecutionIds: [] })
    })
    expect(cacheService.get('topic.stream.status.x')).toBe('done')

    // Stale snapshot arrives AFTER the delta. Must not overwrite 'done'.
    await act(async () => {
      resolveSnapshot({
        x: { status: 'streaming', activeExecutionIds: ['openai::gpt-4o'] },
        y: { status: 'pending', activeExecutionIds: [] }
      })
    })

    expect(cacheService.get('topic.stream.status.x')).toBe('done')
    // Unrelated keys from the snapshot still apply.
    expect(cacheService.get('topic.stream.status.y')).toBe('pending')
  })
})
