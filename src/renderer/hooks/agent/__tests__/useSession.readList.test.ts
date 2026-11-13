import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'

import { useSessions } from '../useSession'

// The cache key is what this suite guards, so it needs the real hooks and a real SWR cache.
vi.unmock('@data/hooks/useDataApi')

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn(), subscribe: vi.fn(() => () => {}) }
}))

vi.mock('@renderer/data/hooks/useReorder', () => ({
  useReorder: vi.fn(() => ({ applyReorderedList: vi.fn(), move: vi.fn(), isPending: false }))
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => vi.fn()
}))

vi.mock('../useSessionChanged', () => ({
  useSessionChanged: vi.fn()
}))

const session = (id: string) => ({ id, agentId: 'agent-1', name: id, orderKey: id })

describe('useSessions readSessionListItems', () => {
  beforeEach(() => {
    vi.mocked(dataApiService.get).mockImplementation((async (
      path: string,
      options?: { query?: { cursor?: string } }
    ) => {
      if (path === '/pins') return [{ id: 'pin-1', entityId: 'session-2', entityType: 'session' }]
      return options?.query?.cursor
        ? { items: [session('session-3')] }
        : { items: [session('session-1'), session('session-2')], nextCursor: 'page-2' }
    }) as never)
  })

  it.each([
    ['every agent', undefined],
    ['one agent', 'agent-1']
  ])('reads the same loaded pages the list shows when scoped to %s', async (_label, agentId) => {
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(() => useSessions(agentId, { loadAll: true, pageSize: 2 }), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.sessions).toHaveLength(3))
    await waitFor(() => expect(result.current.pinIdBySessionId.size).toBe(1))

    expect(result.current.readSessionListItems().map(({ id, pinned }) => [id, pinned])).toEqual([
      ['session-1', false],
      ['session-2', true],
      ['session-3', false]
    ])
  })

  it('keeps the reader stable when the list changes', async () => {
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(() => useSessions(undefined, { loadAll: true, pageSize: 2 }), { wrapper: Wrapper })
    const reader = result.current.readSessionListItems

    await waitFor(() => expect(result.current.sessions).toHaveLength(3))

    expect(result.current.readSessionListItems).toBe(reader)
  })
})
