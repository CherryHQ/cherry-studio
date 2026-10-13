import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { TopicStreamStatus } from '@shared/ai/transport'

import { useFollowupQueue } from '../useFollowupQueue'

vi.unmock('@renderer/data/hooks/useCache')

beforeEach(() => MockCacheUtils.resetMocks())

it.each<TopicStreamStatus>(['pending', 'streaming', 'awaiting-approval', 'error', 'aborted'])(
  'does not send queued drafts while the stream is %s',
  async (status) => {
    const delivered: string[] = []
    cacheService.setShared('topic.stream.statuses.topic', {
      status,
      lastCompletedAt: 100,
      activeExecutions: [],
      awaitingApprovalAnchors: []
    })
    const { result } = renderHook(() =>
      useFollowupQueue({
        scopeKey: 'topic',
        ...useTopicStreamStatus('topic'),
        onDrain: async ({ text }) => {
          delivered.push(text)
          return true
        }
      })
    )
    await act(async () => result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] }))
    expect(delivered).toEqual([])
    expect(result.current.items).toHaveLength(1)
  }
)

it('keeps an in-flight send exclusive across remounts and removes it from the remounted dock', async () => {
  let finish!: (sent: boolean) => void
  const delivered: string[] = []
  const useQueue = () =>
    useFollowupQueue({
      scopeKey: 'topic',
      ...useTopicStreamStatus('topic'),
      onDrain: async ({ text }) => {
        delivered.push(text)
        return new Promise<boolean>((resolve) => {
          finish = resolve
        })
      }
    })
  const first = renderHook(useQueue)
  act(() => first.result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] }))
  await act(async () =>
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      lastCompletedAt: 100,
      activeExecutions: [],
      awaitingApprovalAnchors: []
    })
  )
  first.unmount()
  const second = renderHook(useQueue)
  await act(async () => finish(true))
  expect(delivered).toEqual(['next'])
  expect(second.result.current.items).toEqual([])
})

it('sends a queued follow-up when completion has already been marked read', async () => {
  cacheService.setShared('topic.stream.statuses.topic', {
    status: 'streaming',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  })
  const delivered: string[] = []
  const onDrain = async (payload: { text: string }) => {
    delivered.push(payload.text)
    return true
  }
  const { result } = renderHook(() => {
    const stream = useTopicStreamStatus('topic')
    return useFollowupQueue({ scopeKey: 'topic', ...stream, onDrain })
  })
  act(() => result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] }))
  await act(async () => {
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 100
    })
    cacheService.setShared('topic.stream.last_seen_completion.topic', 100)
  })
  expect(delivered).toEqual(['next'])
  expect(result.current.items).toEqual([])
})

it('resumes a paused queue after the current conversation was marked read', async () => {
  const delivered: string[] = []
  const { result } = renderHook(() =>
    useFollowupQueue({
      scopeKey: 'topic',
      ...useTopicStreamStatus('topic'),
      onDrain: async ({ text }) => {
        delivered.push(text)
        return true
      }
    })
  )
  act(() => {
    result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] })
    result.current.setPaused(true)
  })
  await act(async () => {
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 100
    })
    cacheService.setShared('topic.stream.last_seen_completion.topic', 100)
  })
  expect(delivered).toEqual([])
  await act(async () => result.current.setPaused(false))
  expect(delivered).toEqual(['next'])
  expect(result.current.items).toEqual([])
})

it('preserves a failed draft and lets resume retry without another model completion', async () => {
  let canSend = false
  const delivered: string[] = []
  const { result } = renderHook(() =>
    useFollowupQueue({
      scopeKey: 'topic',
      ...useTopicStreamStatus('topic'),
      onDrain: async ({ text }) => {
        if (!canSend) return false
        delivered.push(text)
        return true
      }
    })
  )
  act(() => result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] }))
  await act(async () =>
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 100
    })
  )
  expect(result.current.paused).toBe(true)
  expect(result.current.items.map(({ payload }) => payload.text)).toEqual(['next'])
  canSend = true
  await act(async () => result.current.setPaused(false))
  expect(delivered).toEqual(['next'])
  expect(result.current.items).toEqual([])
})

it('sends once per completion even across remounts, then sends the next FIFO item', async () => {
  const delivered: string[] = []
  const useQueue = () =>
    useFollowupQueue({
      scopeKey: 'topic',
      ...useTopicStreamStatus('topic'),
      onDrain: async ({ text }) => {
        delivered.push(text)
        return true
      }
    })
  const first = renderHook(useQueue, { wrapper: StrictMode })
  act(() => {
    first.result.current.enqueue({ text: 'one', tokens: [] }, { text: 'one', userMessageParts: [] })
    first.result.current.enqueue({ text: 'two', tokens: [] }, { text: 'two', userMessageParts: [] })
  })
  await act(async () =>
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 100
    })
  )
  first.unmount()
  const second = renderHook(useQueue, { wrapper: StrictMode })
  expect(delivered).toEqual(['one'])
  expect(second.result.current.items.map(({ payload }) => payload.text)).toEqual(['two'])
  await act(async () =>
    cacheService.setShared('topic.stream.statuses.topic', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 200
    })
  )
  expect(delivered).toEqual(['one', 'two'])
  expect(second.result.current.items).toEqual([])
})

it('settles a pending send in its original queue after switching conversations', async () => {
  let finish!: (sent: boolean) => void
  const delivered: string[] = []
  const onDrain = async ({ text }: { text: string }) => {
    delivered.push(text)
    return new Promise<boolean>((resolve) => {
      finish = resolve
    })
  }
  const { result, rerender } = renderHook(
    ({ scopeKey }) =>
      useFollowupQueue({
        scopeKey,
        ...useTopicStreamStatus(scopeKey),
        onDrain
      }),
    { initialProps: { scopeKey: 'one' } }
  )
  act(() => result.current.enqueue({ text: 'first', tokens: [] }, { text: 'first', userMessageParts: [] }))
  await act(async () =>
    cacheService.setShared('topic.stream.statuses.one', {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 100
    })
  )
  rerender({ scopeKey: 'two' })
  act(() => result.current.enqueue({ text: 'second', tokens: [] }, { text: 'second', userMessageParts: [] }))
  await act(async () => finish(true))
  expect(result.current.items.map(({ payload }) => payload.text)).toEqual(['second'])
  rerender({ scopeKey: 'one' })
  expect(result.current.items).toEqual([])
  expect(delivered).toEqual(['first'])
})

it.each(['automatic', 'manual'] as const)(
  'delivers a queued item once when %s sending races with steer and remounts',
  async (firstSender) => {
    let finish!: (sent: boolean) => void
    const delivered: string[] = []
    const useQueue = () =>
      useFollowupQueue({
        scopeKey: 'topic',
        ...useTopicStreamStatus('topic'),
        onDrain: async ({ text }) => {
          delivered.push(text)
          return new Promise<boolean>((resolve) => {
            finish = resolve
          })
        }
      })
    const first = renderHook(useQueue)
    act(() => first.result.current.enqueue({ text: 'next', tokens: [] }, { text: 'next', userMessageParts: [] }))
    const id = first.result.current.items[0].id
    if (firstSender === 'manual') {
      act(() => {
        void first.result.current.sendId(id)
      })
    }
    await act(async () => {
      cacheService.setShared('topic.stream.statuses.topic', {
        status: 'done',
        lastCompletedAt: 100,
        activeExecutions: [],
        awaitingApprovalAnchors: []
      })
    })
    await act(async () => {
      expect(await first.result.current.sendId(id)).toBe(false)
    })
    first.unmount()
    const second = renderHook(useQueue, { wrapper: StrictMode })
    await act(async () => {
      expect(await second.result.current.sendId(id)).toBe(false)
    })
    expect(delivered).toEqual(['next'])
    expect(second.result.current.items.map(({ payload }) => payload.text)).toEqual(['next'])
    await act(async () => finish(true))
    expect(second.result.current.items).toEqual([])
    await act(async () => {
      expect(await second.result.current.sendId(id)).toBe(false)
    })
    expect(delivered).toEqual(['next'])
  }
)

it('consumes an idle completion when manually sending from a paused queue', async () => {
  const delivered: string[] = []
  const { result, rerender } = renderHook(
    ({ lastCompletedAt }) =>
      useFollowupQueue({
        scopeKey: 'topic',
        status: 'done',
        lastCompletedAt,
        onDrain: async ({ text }) => {
          delivered.push(text)
          return true
        }
      }),
    { initialProps: { lastCompletedAt: 100 } }
  )
  act(() => {
    result.current.setPaused(true)
    result.current.enqueue({ text: 'one', tokens: [] }, { text: 'one', userMessageParts: [] })
    result.current.enqueue({ text: 'two', tokens: [] }, { text: 'two', userMessageParts: [] })
  })
  await act(async () => {
    expect(await result.current.sendId(result.current.items[0].id)).toBe(true)
  })
  await act(async () => result.current.setPaused(false))
  expect(delivered).toEqual(['one'])
  expect(result.current.items.map(({ payload }) => payload.text)).toEqual(['two'])
  await act(async () => rerender({ lastCompletedAt: 200 }))
  expect(delivered).toEqual(['one', 'two'])
  expect(result.current.items).toEqual([])
})

it.each<TopicStreamStatus>(['streaming', 'done'])(
  'preserves a new completion after a manual send starts while %s and settles unmounted',
  async (initialStatus) => {
    let finish!: (sent: boolean) => void
    const delivered: string[] = []
    const setStatus = (status: TopicStreamStatus, lastCompletedAt: number) =>
      cacheService.setShared('topic.stream.statuses.topic', {
        status,
        lastCompletedAt,
        activeExecutions: [],
        awaitingApprovalAnchors: []
      })
    setStatus(initialStatus, 100)
    const useQueue = () =>
      useFollowupQueue({
        scopeKey: 'topic',
        ...useTopicStreamStatus('topic'),
        onDrain: async ({ text }) => {
          delivered.push(text)
          return text === 'one'
            ? new Promise<boolean>((resolve) => {
                finish = resolve
              })
            : true
        }
      })
    const first = renderHook(useQueue)
    act(() => {
      first.result.current.setPaused(true)
      first.result.current.enqueue({ text: 'one', tokens: [] }, { text: 'one', userMessageParts: [] })
      first.result.current.enqueue({ text: 'two', tokens: [] }, { text: 'two', userMessageParts: [] })
    })
    act(() => {
      void first.result.current.sendId(first.result.current.items[0].id)
    })
    first.unmount()
    await act(async () => setStatus('done', 200))
    await act(async () => finish(true))
    const second = renderHook(useQueue, { wrapper: StrictMode })
    expect(delivered).toEqual(['one'])
    await act(async () => second.result.current.setPaused(false))
    expect(delivered).toEqual(['one', 'two'])
    expect(second.result.current.items).toEqual([])
  }
)

it.each(['pending', 'settled'] as const)(
  'does not release another manual send completion claim when it is %s',
  async (firstState) => {
    let finish!: (sent: boolean) => void
    const attempted: string[] = []
    const { result, rerender } = renderHook(
      ({ lastCompletedAt }) =>
        useFollowupQueue({
          scopeKey: 'topic',
          status: 'done',
          lastCompletedAt,
          onDrain: async ({ text }) => {
            attempted.push(text)
            return text === 'one'
              ? new Promise<boolean>((resolve) => {
                  finish = resolve
                })
              : false
          }
        }),
      { initialProps: { lastCompletedAt: 100 } }
    )
    act(() => {
      result.current.setPaused(true)
      result.current.enqueue({ text: 'one', tokens: [] }, { text: 'one', userMessageParts: [] })
      result.current.enqueue({ text: 'two', tokens: [] }, { text: 'two', userMessageParts: [] })
    })
    const [first, second] = result.current.items
    act(() => {
      void result.current.sendId(first.id)
    })
    if (firstState === 'settled') await act(async () => finish(true))
    await act(async () => {
      expect(await result.current.sendId(second.id)).toBe(false)
    })
    await act(async () => result.current.setPaused(false))
    if (firstState === 'pending') await act(async () => finish(true))
    expect(attempted).toEqual(['one', 'two'])
    expect(result.current.items.map(({ payload }) => payload.text)).toEqual(['two'])
    await act(async () => rerender({ lastCompletedAt: 200 }))
    expect(attempted).toEqual(['one', 'two', 'two'])
    expect(result.current.paused).toBe(true)
  }
)

it.each([
  { failure: 'false', completes: false },
  { failure: 'reject', completes: false },
  { failure: 'false', completes: true },
  { failure: 'reject', completes: true }
])(
  'releases a failed manual claim ($failure, completion=$completes) so its preserved draft can be retried',
  async ({ failure, completes }) => {
    let finish!: () => void
    let attempts = 0
    const delivered: string[] = []
    const { result } = renderHook(
      ({ status }: { status: TopicStreamStatus }) =>
        useFollowupQueue({
          scopeKey: 'topic',
          status,
          lastCompletedAt: status === 'done' ? 100 : null,
          onDrain: async ({ text }) => {
            attempts += 1
            if (attempts === 1) {
              return new Promise<boolean>((resolve, reject) => {
                finish = () => (failure === 'reject' ? reject(new Error('send failed')) : resolve(false))
              })
            }
            delivered.push(text)
            return true
          }
        }),
      { initialProps: { status: (completes ? 'done' : 'streaming') as TopicStreamStatus } }
    )
    act(() => {
      result.current.setPaused(true)
      result.current.enqueue({ text: 'retry me', tokens: [] }, { text: 'retry me', userMessageParts: [] })
    })
    const id = result.current.items[0].id
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.sendId(id)
    })
    await act(async () => {
      expect(await result.current.sendId(id)).toBe(false)
      finish()
      expect(await pending).toBe(false)
    })
    expect(attempts).toBe(1)
    expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['retry me'])
    await act(async () => {
      if (completes) {
        expect(result.current.paused).toBe(true)
        result.current.setPaused(false)
      } else {
        expect(await result.current.sendId(id)).toBe(true)
      }
    })
    expect(delivered).toEqual(['retry me'])
    expect(result.current.items).toEqual([])
  }
)
