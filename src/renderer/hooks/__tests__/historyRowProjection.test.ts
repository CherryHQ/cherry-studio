import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { unstable_serialize } from 'swr'
import { unstable_serialize as serializeInfinite } from 'swr/infinite'
import { expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { createSWRTestWrapper, installCacheApiMock } from '@renderer/data/hooks/__tests__/testUtils'
import type { TopicView } from '@renderer/utils/message/projectedReplies'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { Message } from '@shared/data/types/message'

import { useAgentSessionParts } from '../useAgentSessionParts'
import { useHistoryReplies } from '../useHistoryReplies'
import { useTopicMessages } from '../useTopicMessages'

vi.unmock('@data/hooks/useDataApi')
vi.unmock('@data/hooks/useCache')
vi.unmock('@data/CacheService')

it.each([20, 20_000])('renders a saved reply without reading unrelated rows in a %i-message history', async (count) => {
  installCacheApiMock()
  MockUsePreferenceUtils.setPreferenceValue('chat.message.navigation_mode', 'none')
  const { Wrapper, cache } = createSWRTestWrapper()
  let reads = 0
  const watch = <T extends object>(value: T): T =>
    new Proxy(value, {
      get(target, key, receiver) {
        reads++
        return Reflect.get(target, key, receiver)
      }
    })
  const row = (id: string): Message & AgentSessionMessageEntity => ({
    id,
    role: 'assistant',
    topicId: 'topic',
    sessionId: 'session',
    parentId: null,
    data: { parts: [] },
    searchableText: '',
    status: 'pending',
    siblingsGroupId: 0,
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
  const rows = Array.from({ length: count }, (_, i) => (i === 0 ? row('target') : watch(row(String(i)))))
  const chunked = Array.from({ length: Math.ceil(count / 50) }, (_, page) => ({
    items: rows.slice(page * 50, (page + 1) * 50),
    nextCursor: page * 50 + 50 < count ? String(page + 1) : undefined
  }))
  const agentPages = chunked
  const homePages = chunked.map((page) => ({
    ...page,
    activeNodeId: 'target',
    assistantId: null,
    rootId: null,
    items: page.items.map((message) => ({ message }))
  }))
  const seed = (path: string, query: object, pages: { items: unknown[]; nextCursor?: string }[]) => {
    const key = (i: number) => [path, { ...query, limit: 50, ...(i && { cursor: String(i) }) }]
    const data = { data: pages, _l: pages.length }
    cache.set(
      serializeInfinite(() => key(0)),
      data
    )
    pages.forEach((page, i) => cache.set(unstable_serialize(key(i)), { data: page }))
  }
  seed('/topics/topic/messages', { includeSiblings: true }, homePages)
  seed('/agent-sessions/session/messages', { deferToolOutputs: true }, agentPages)
  const terminal: TopicView = {
    kind: 'topic',
    topicId: 'topic',
    revision: 2,
    executions: [{ executionId: 'p::m', attemptId: 1, messageId: 'target', status: 'done', savedMessageId: 'target' }],
    messages: [{ id: 'target', role: 'assistant', parts: [{ type: 'text', text: 'Streaming body' }] }]
  }
  const home = renderHook(
    ({ done }) => {
      const history = useTopicMessages('topic', { fetchOnMount: false })
      return { history, live: useHistoryReplies(done ? terminal : null, [], history.replyHistory, 'done') }
    },
    { wrapper: Wrapper, initialProps: { done: false } }
  )
  const agent = renderHook(
    ({ done }) => {
      const history = useAgentSessionParts('session', { fetchOnMount: false })
      return {
        history,
        live: useHistoryReplies(
          done ? { ...terminal, topicId: 'agent-session:session' } : null,
          [],
          history.replyHistory,
          'done'
        )
      }
    },
    { wrapper: Wrapper, initialProps: { done: false } }
  )
  const saved = { ...row('target'), data: { parts: [{ type: 'text', text: 'Saved body' }] }, status: 'success' }
  mockDataApiService.get.mockClear().mockResolvedValue(saved)
  reads = 0
  const cacheReads = vi.spyOn(cacheService, 'getSharedSnapshot').mockClear()
  await act(async () => home.rerender({ done: true }))
  expect(home.result.current.live).toEqual([])
  expect(home.result.current.history.uiMessages.find((m) => m.id === 'target')?.parts).toEqual(saved.data.parts)
  expect(reads).toBe(0)
  await act(async () => agent.rerender({ done: true }))
  expect(agent.result.current.live).toEqual([])
  expect(agent.result.current.history.messages.at(-1)?.parts).toEqual(saved.data.parts)
  expect(reads).toBe(0)
  expect(cacheReads).not.toHaveBeenCalled()
  cacheReads.mockRestore()
  expect(mockDataApiService.get.mock.calls.map(([path]) => path)).toEqual([
    '/messages/target',
    '/agent-sessions/session/messages/target'
  ])
})

it('preserves a later edit when an older read of the same reply finishes last', async () => {
  const { Wrapper } = createSWRTestWrapper()
  const row = (text: string) => ({
    id: 'reply',
    topicId: 'topic',
    role: 'assistant',
    status: 'success',
    data: { parts: [{ type: 'text', text }] }
  })
  mockDataApiService.get.mockResolvedValueOnce({ items: [{ message: row('baseline') }], activeNodeId: 'reply' })
  const hook = renderHook(() => useTopicMessages('topic'), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.replyHistory.has('reply')).toBe(true))
  const older = Promise.withResolvers<ReturnType<typeof row>>()
  mockDataApiService.get.mockReturnValueOnce(older.promise).mockResolvedValueOnce(row('edited'))
  const stale = hook.result.current.replyHistory.refreshRow('reply')
  await act(() => hook.result.current.replyHistory.refreshRow('reply'))
  await act(async () => {
    older.resolve(row('original'))
    await stale
  })
  expect(hook.result.current.uiMessages[0].parts).toEqual(row('edited').data.parts)
})
