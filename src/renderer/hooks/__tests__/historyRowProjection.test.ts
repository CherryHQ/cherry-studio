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
  await waitFor(() => expect(hook.result.current.replyHistory.lookup('reply').kind).toBe('row'))
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

it.each(
  ['Agent', 'Home'].flatMap((kind) => ['selected', 'queued', 'sibling', 'partial'].map((branch) => ({ kind, branch })))
)(
  'resolves an observed $kind reply against the $branch branch after a failed reservation read',
  async ({ kind, branch }) => {
    installCacheApiMock()
    const { Wrapper } = createSWRTestWrapper()
    const sessionId = 'observed'
    const agent = kind === 'Agent'
    const path = agent ? '/agent-sessions/observed/messages' : '/topics/observed/messages'
    const endpoint = agent ? '/agent-sessions/:sessionId/messages' : '/topics/:topicId/messages'
    const routeParams = agent ? { sessionId } : { topicId: sessionId }

    const row = (id: string, role: 'user' | 'assistant', status: 'pending' | 'success', text: string) => ({
      id,
      sessionId,
      topicId: sessionId,
      role,
      status,
      data: { parts: [{ type: 'text' as const, text }] }
    })
    const prefix = row('prefix', 'user', 'success', 'prior branch')
    const pending = row('answer', 'assistant', 'pending', '')
    const user = row('input', 'user', 'success', 'new turn')
    const saved = row('answer', 'assistant', 'success', 'committed reply')
    const page = (rows: (typeof prefix)[], nextCursor?: string) => ({
      items: agent ? rows : rows.toReversed().map((message) => ({ message })),
      ...(nextCursor && { nextCursor })
    })
    const reservation = Promise.withResolvers<ReturnType<typeof page>>()
    const retry = Promise.withResolvers<ReturnType<typeof page>>()
    const committed = Promise.withResolvers<typeof saved>()
    const initial = branch === 'queued' ? [user, prefix] : [prefix]
    mockDataApiService.get.mockResolvedValueOnce(page(initial))
    const terminal: TopicView = {
      kind: 'topic',
      topicId: agent ? 'agent-session:observed' : sessionId,
      revision: 2,
      executions: [
        { executionId: 'p::m', attemptId: 1, messageId: 'answer', status: 'done', savedMessageId: 'answer' }
      ],
      messages: [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'live reply' }] }]
    }
    const useHistory = agent
      ? () => useAgentSessionParts(sessionId)
      : () => {
          const value = useTopicMessages(sessionId)
          return { messages: value.uiMessages, replyHistory: value.replyHistory }
        }
    const observer = renderHook(
      ({ done }) => {
        const history = useHistory()
        return { history, live: useHistoryReplies(done ? terminal : null, [], history.replyHistory, 'done') }
      },
      { wrapper: Wrapper, initialProps: { done: false } }
    )
    await waitFor(() =>
      expect(observer.result.current.history.messages.map(({ id }) => id)).toEqual(
        initial.toReversed().map(({ id }) => id)
      )
    )
    mockDataApiService.get.mockReturnValueOnce(reservation.promise).mockImplementation(async (url) => {
      if (url === path) return retry.promise
      if (url === (agent ? path + '/answer' : '/messages/answer')) return committed.promise
      throw new Error('Unexpected row ' + url)
    })
    const membership = () =>
      mockDataApiService._emitDataChange([
        {
          endpoint,
          kind: 'membership',
          routeParams,
          entityIds: branch === 'queued' ? ['answer'] : ['input', 'answer']
        }
      ])
    await act(async () => membership())
    observer.rerender({ done: true })
    expect(observer.result.current.live).toEqual(terminal.messages)
    await act(async () => reservation.reject(new Error('membership offline')))
    expect(observer.result.current.live).toEqual(terminal.messages)
    await act(async () =>
      mockDataApiService._emitDataChange([
        {
          endpoint,
          kind: 'projection',
          routeParams,
          entityIds: ['answer']
        }
      ])
    )
    if (branch === 'sibling' || branch === 'partial') {
      await act(async () => retry.resolve(page([prefix], branch === 'partial' ? 'older' : undefined)))
      expect(observer.result.current.live).toEqual(branch === 'sibling' ? [] : terminal.messages)
      expect(observer.result.current.history.messages.map(({ id }) => id)).toEqual(['prefix'])
      return
    }
    await act(async () => retry.resolve(page([pending, user, prefix])))
    expect(observer.result.current.history.messages.map(({ id }) => id)).toEqual(['prefix', 'input', 'answer'])
    expect(observer.result.current.live).toEqual(terminal.messages)
    await act(async () => committed.resolve(saved))
    expect(observer.result.current.live).toEqual([])
    expect(observer.result.current.history.messages.at(-1)?.parts).toEqual(saved.data.parts)

    mockDataApiService.get.mockResolvedValue(page([prefix]))
    await act(async () => membership())
    expect(observer.result.current.history.messages.map(({ id }) => id)).toEqual(['prefix'])
    expect(observer.result.current.live).toEqual([])
  }
)
