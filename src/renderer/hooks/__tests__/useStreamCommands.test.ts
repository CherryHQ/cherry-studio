import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { MessageProjectionView, TopicProjectionState } from '@shared/ai/messageProjection'

import { useStreamCommands } from '../useStreamCommands'

afterEach(() => vi.restoreAllMocks())

// A rebuilt Error drops provider status and body, so 5xx-gated diagnosis could never apply.
it('hands the stored error part to onError with provider detail intact', async () => {
  const ipc = projectionIpc()
  const stored = {
    name: 'AI_APICallError',
    message: 'Service Unavailable',
    stack: 'stored stack',
    statusCode: 503,
    responseBody: '{"error":"overloaded"}'
  }
  const view: MessageProjectionView<TopicProjectionState> = {
    kind: 'topic',
    topicId: 'stored-error',
    revision: 1,
    executions: [{ executionId: 'p::m', attemptId: 1, userMessageId: 'u', messageId: 'reply', status: 'error' }],
    messages: [{ id: 'reply', role: 'assistant', parts: [{ type: 'data-error', data: stored }] }]
  }
  const onError = vi.fn()
  const hook = renderHook(() => useStreamCommands('stored-error', undefined, onError))
  await act(async () => ipc.attachments[0].resolve(view))
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  const [error, cause] = onError.mock.calls[0]
  expect(error.message).toBe('Service Unavailable')
  expect(cause).toMatchObject({ statusCode: 503, responseBody: '{"error":"overloaded"}', stack: 'stored stack' })
  hook.unmount()
})
