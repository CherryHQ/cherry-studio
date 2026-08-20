import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const invalidateCachedMessageUiStates = vi.hoisted(() => vi.fn())

vi.mock('../../utils/messageUiStateCache', () => ({ invalidateCachedMessageUiStates }))

import { useClearTopicMessages } from '../useClearTopicMessages'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
})

it('clears the requested topic and discards UI state for its deleted messages', async () => {
  const clearTrigger = vi.fn().mockResolvedValue({ deletedIds: ['message-b'] })
  MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics/:topicId/messages', clearTrigger)
  const { result } = renderHook(() => useClearTopicMessages())

  await act(() => result.current('topic-b'))

  expect(clearTrigger).toHaveBeenCalledExactlyOnceWith({ params: { topicId: 'topic-b' } })
  expect(invalidateCachedMessageUiStates).toHaveBeenCalledExactlyOnceWith(['message-b'])
})
