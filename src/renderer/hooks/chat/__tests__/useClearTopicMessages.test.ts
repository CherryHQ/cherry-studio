import type { RefreshOption } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const invalidateCachedMessageUiStates = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/messageUiStateCache', () => ({ invalidateCachedMessageUiStates }))

import { useClearTopicMessages } from '../useClearTopicMessages'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
})

it('clears the requested topic, refreshes its read models, and discards deleted-message UI state', async () => {
  const clearTrigger = vi.fn().mockResolvedValue({ deletedIds: ['message-b'] })
  MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics/:topicId/messages', clearTrigger)
  const { result } = renderHook(() => useClearTopicMessages())
  const options = mockUseMutation.mock.calls[0]?.[2] as
    | { refresh?: RefreshOption<'/topics/:topicId/messages', 'DELETE'> }
    | undefined

  if (typeof options?.refresh !== 'function') throw new Error('Expected a refresh resolver')
  expect(options.refresh({ args: { params: { topicId: 'topic-b' } }, result: { deletedIds: ['message-b'] } })).toEqual([
    '/topics',
    '/topics/topic-b',
    '/topics/latest',
    '/topics/topic-b/messages',
    '/topics/topic-b/tree'
  ])

  await act(() => result.current('topic-b'))

  expect(clearTrigger).toHaveBeenCalledExactlyOnceWith({ params: { topicId: 'topic-b' } })
  expect(invalidateCachedMessageUiStates).toHaveBeenCalledExactlyOnceWith(['message-b'])
})
