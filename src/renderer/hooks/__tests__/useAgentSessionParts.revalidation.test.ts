import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@data/hooks/__tests__/testUtils'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'

import { useAgentSessionParts } from '../useAgentSessionParts'

vi.unmock('@data/hooks/useDataApi')

const listPath = '/agent-sessions/session-1/messages'

function message(id: string, text = id, updatedAt = '2026-01-01T00:00:00.000Z'): AgentSessionMessageEntity {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    data: { parts: [{ type: 'text', text }] },
    searchableText: text,
    status: 'success',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt
  }
}

afterEach(() => vi.restoreAllMocks())

it('refreshes a changed message without requesting any loaded history page', async () => {
  const newest = message('newest')
  const older = message('older')
  const updated = message('older', 'updated older reply', '2026-01-01T00:00:01.000Z')
  let currentOlder = older
  const requestedPaths: string[] = []
  const get = vi.spyOn(dataApiService, 'get')
  get.mockImplementation(async (path, options) => {
    requestedPaths.push(path)
    if (path === `${listPath}/older`) return updated as never
    if (path !== listPath) throw new Error(`Unexpected GET ${path}`)
    return (
      (options?.query as { cursor?: string })?.cursor
        ? { items: [currentOlder] }
        : { items: [newest], nextCursor: 'older-page' }
    ) as never
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useAgentSessionParts('session-1'), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['newest']))
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['older', 'newest']))

  currentOlder = updated
  requestedPaths.length = 0
  await act(async () => {
    MockDataApiUtils.emitDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: 'session-1' },
        entityIds: ['older']
      }
    ])
  })

  await waitFor(() => expect(result.current.messages[0].parts).toEqual(updated.data.parts))
  expect(requestedPaths).toEqual([`${listPath}/older`])
})

it('keeps older pages cached when new messages only extend the head of the selected branch', async () => {
  const newest = message('newest')
  const older = message('older')
  const added = message('added')
  const requestedCursors: (string | undefined)[] = []
  vi.spyOn(dataApiService, 'get').mockImplementation(async (_path, options) => {
    const query = options?.query as { cursor?: string; limit: number }
    requestedCursors.push(query.cursor)
    if (query.cursor) return { items: [older] } as never
    return { items: query.limit === 2 ? [added, newest] : [newest], nextCursor: 'older-page' } as never
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useAgentSessionParts('session-1'), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['newest']))
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['older', 'newest']))
  requestedCursors.length = 0

  await act(async () => {
    MockDataApiUtils.emitDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'membership',
        routeParams: { sessionId: 'session-1' },
        entityIds: ['added']
      }
    ])
  })

  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['older', 'newest', 'added']))
  expect(requestedCursors).toEqual([undefined])
})

it('applies a message update received while loading older history without interrupting pagination', async () => {
  const newest = message('newest')
  const older = message('older')
  const updated = message('newest', 'updated newest reply', '2026-01-01T00:00:01.000Z')
  const pendingPage = Promise.withResolvers<{ items: AgentSessionMessageEntity[] }>()
  const get = vi.spyOn(dataApiService, 'get').mockImplementation(async (path, options) => {
    if (path === `${listPath}/newest`) return updated as never
    const query = options?.query as { cursor?: string }
    if (query.cursor) return (await pendingPage.promise) as never
    return { items: [newest], nextCursor: 'older-page' } as never
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useAgentSessionParts('session-1'), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['newest']))
  act(() => result.current.loadOlder())
  await waitFor(() => expect(get.mock.calls.some(([, options]) => options?.query?.cursor === 'older-page')).toBe(true))
  get.mockClear()

  await act(async () => {
    MockDataApiUtils.emitDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'projection', entityIds: ['newest'] }
    ])
    pendingPage.resolve({ items: [older] })
  })

  await waitFor(() =>
    expect(result.current.messages.map((row) => row.parts)).toEqual([older.data.parts, updated.data.parts])
  )
  expect(get.mock.calls.map(([path]) => path)).toEqual([`${listPath}/newest`])
})

it('rebuilds the cursor chain when the selected branch changes', async () => {
  const cached = [message('newest'), message('older')]
  const replacement = [message('other-tip'), message('other-parent')]
  let selected = cached
  vi.spyOn(dataApiService, 'get').mockImplementation(async (_path, options) => {
    const query = options?.query as { cursor?: string }
    return (query.cursor ? { items: [selected[1]] } : { items: [selected[0]], nextCursor: selected[0].id }) as never
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(() => useAgentSessionParts('session-1'), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['newest']))
  act(() => result.current.loadOlder())
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['older', 'newest']))

  selected = replacement
  await act(async () => {
    MockDataApiUtils.emitDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', routeParams: { sessionId: 'session-1' } }
    ])
  })
  await waitFor(() => expect(result.current.messages.map((row) => row.id)).toEqual(['other-parent', 'other-tip']))
})
