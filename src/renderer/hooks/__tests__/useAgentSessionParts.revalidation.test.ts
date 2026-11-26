import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { createSWRTestWrapper, installCacheApiMock } from '@renderer/data/hooks/__tests__/testUtils'

import { useAgentSessionParts } from '../useAgentSessionParts'

vi.unmock('@data/hooks/useDataApi')
vi.unmock('@data/hooks/useCache')
vi.unmock('@data/CacheService')

const sessionId = 'session'
const path = '/agent-sessions/session/messages'
const row = (id: string) => ({ id, sessionId, role: 'user', status: 'success', data: { parts: [] } })
const rows = (start: number, count: number) => Array.from({ length: count }, (_, i) => row(`message-${i + start}`))

function history(initial: ReturnType<typeof rows>) {
  installCacheApiMock()
  let selected = initial
  const getPage = ({ limit = 50, cursor }: { limit?: number; cursor?: string } = {}) => {
    const newestFirst = selected.toReversed()
    const start = cursor ? newestFirst.findIndex(({ id }) => id === cursor) + 1 : 0
    const items = newestFirst.slice(start, start + limit)
    return { items, nextCursor: start + items.length < selected.length ? items.at(-1)?.id : undefined }
  }
  mockDataApiService.get.mockReset().mockImplementation(async (_path, options) => getPage(options?.query))
  const { Wrapper } = createSWRTestWrapper()
  const hook = renderHook(() => useAgentSessionParts(sessionId), { wrapper: Wrapper })
  const ids = () => hook.result.current.messages.map(({ id }) => id)
  const membership = (entityIds?: string[]) =>
    mockDataApiService._emitDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', routeParams: { sessionId }, kind: 'membership', entityIds }
    ])
  return { hook, ids, membership, getPage, select: (next: typeof selected) => (selected = next) }
}

it.each([
  { scenario: 'successive turns', sizes: [2, 2, ...Array.from({ length: 12 }, () => 17)] },
  { scenario: 'one notification', sizes: [203] }
])('keeps every loaded message through more than 200 new messages ($scenario)', async ({ sizes }) => {
  const { hook, ids, membership, select } = history(rows(0, 150))
  await waitFor(() => expect(ids()).toEqual(rows(100, 50).map(({ id }) => id)))
  await act(async () => hook.result.current.loadOlder())
  await waitFor(() => expect(ids()).toEqual(rows(50, 100).map(({ id }) => id)))

  let head = 150
  for (const count of sizes) {
    const added = rows(head, count).map(({ id }) => id)
    head += count
    select(rows(0, head))
    mockDataApiService.get.mockClear()
    await act(async () => {
      membership(added)
      await hook.result.current.refreshReservedMessages(added)
    })
    await waitFor(() => expect(ids()).toEqual(rows(50, head - 50).map(({ id }) => id)))
    const requests = mockDataApiService.get.mock.calls.filter(([url]) => url === path)
    if (count === 2) expect(requests).toHaveLength(1)
    expect(requests.every(([, options]) => options?.query?.cursor !== 'message-100')).toBe(true)
  }

  await act(async () => hook.result.current.loadOlder())
  await waitFor(() => expect(ids()).toEqual(rows(0, head).map(({ id }) => id)))
})

it('discards a pending append when the selected branch changes', async () => {
  const { ids, membership, select, getPage } = history(rows(0, 100))
  await waitFor(() => expect(ids()[0]).toBe('message-50'))
  select(rows(0, 102))
  const stale = getPage()
  const pending = Promise.withResolvers<typeof stale>()
  mockDataApiService.get.mockReturnValueOnce(pending.promise)
  await act(async () => membership(['message-100', 'message-101']))

  const branch = [row('different-branch')]
  select(branch)
  await act(async () => membership())
  await waitFor(() => expect(ids()).toEqual(['different-branch']))
  await act(async () => pending.resolve(stale))
  expect(ids()).toEqual(['different-branch'])
})
