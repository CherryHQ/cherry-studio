import type { RefreshOption } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const invalidateCachedMessageUiStates = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/messageUiStateCache', () => ({ invalidateCachedMessageUiStates }))

import { useClearAgentSessionMessages } from '../useClearAgentSessionMessages'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
})

it('clears the requested Agent session, refreshes its read models, and discards deleted-message UI state', async () => {
  const clearTrigger = vi.fn().mockResolvedValue({ deletedIds: ['message-b'] })
  MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agent-sessions/:sessionId/messages', clearTrigger)
  const { result } = renderHook(() => useClearAgentSessionMessages())
  const options = mockUseMutation.mock.calls[0]?.[2] as
    | { refresh?: RefreshOption<'/agent-sessions/:sessionId/messages', 'DELETE'> }
    | undefined

  if (typeof options?.refresh !== 'function') throw new Error('Expected a refresh resolver')
  expect(
    options.refresh({ args: { params: { sessionId: 'session-b' } }, result: { deletedIds: ['message-b'] } })
  ).toEqual([
    '/agent-sessions',
    '/agent-sessions/session-b',
    '/agent-sessions/latest',
    '/agent-sessions/session-b/messages'
  ])

  await act(() => result.current('session-b'))

  expect(clearTrigger).toHaveBeenCalledExactlyOnceWith({ params: { sessionId: 'session-b' } })
  expect(invalidateCachedMessageUiStates).toHaveBeenCalledExactlyOnceWith(['message-b'])
})
