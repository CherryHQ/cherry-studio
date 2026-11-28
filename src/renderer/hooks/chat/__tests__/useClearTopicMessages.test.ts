import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { RefreshOption } from '@data/hooks/useDataApi'
import { messageEditingSessionService } from '@renderer/services/MessageEditingSessionService'

const invalidateCachedMessageUiStates = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/messageUiStateCache', () => ({ invalidateCachedMessageUiStates }))

import { useClearTopicMessages } from '../useClearTopicMessages'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  messageEditingSessionService.clearAll()
  vi.clearAllMocks()
})

it('clears the requested topic, refreshes its read models, and discards deleted-message UI state and edit sessions', async () => {
  const clearTrigger = vi.fn().mockResolvedValue({ deletedIds: ['message-b'] })
  MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics/:topicId/messages', clearTrigger)
  messageEditingSessionService.startSession(
    {
      id: 'message-b',
      role: 'user',
      topicId: 'topic-b',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as any,
    [{ type: 'text', text: 'draft' }] as any
  )
  messageEditingSessionService.startSession(
    {
      id: 'message-a',
      role: 'user',
      topicId: 'topic-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as any,
    [{ type: 'text', text: 'other' }] as any
  )
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
  expect(messageEditingSessionService.getSession('topic-b')).toBeUndefined()
  expect(messageEditingSessionService.getSession('topic-a')?.snapshot.message.id).toBe('message-a')
})
