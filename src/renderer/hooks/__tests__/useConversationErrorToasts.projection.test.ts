import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { MessageProjectionView, TopicProjectionState } from '@shared/ai/messageProjection'

import { useConversationErrorToasts } from '../useConversationErrorToasts'
import { useTopicCompletion } from '../useTopicCompletion'

afterEach(() => vi.restoreAllMocks())

const queued = [{ id: 'queued-user', role: 'user' as const, parts: [] }]
const error = { name: 'Error', message: 'queued execution failed', stack: '' }
function terminal(
  topicId: string,
  status: 'done' | 'error' | 'unresolved'
): MessageProjectionView<TopicProjectionState> {
  return {
    kind: 'topic',
    topicId,
    revision: 1,
    executions: [
      {
        executionId: 'p::m',
        attemptId: 10,
        userMessageId: 'queued-user',
        messageId: 'reply',
        ...(status === 'unresolved' ? { status, persistenceError: error } : { status })
      }
    ],
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'answer' },
          ...(status === 'done' ? [] : [{ type: 'data-error' as const, data: error }])
        ]
      }
    ]
  }
}

// A queued ACK has no assistant attempt; only the projected user identity can settle its waiter.
it.each([
  { beforeAck: false, status: 'done' },
  { beforeAck: false, status: 'error' },
  { beforeAck: false, status: 'unresolved' },
  { beforeAck: true, status: 'done' },
  { beforeAck: true, status: 'error' },
  { beforeAck: true, status: 'unresolved' }
] as const)('settles queued recovery from projection alone: %j', async ({ beforeAck, status }) => {
  const ipc = projectionIpc()
  const topic = `queued-${beforeAck}-${status}`
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useTopicCompletion(topic, [], feedback.onFinish)
    return feedback
  })
  const accepted = Promise.withResolvers<void>()
  const outcomes: unknown[] = []
  let completion!: Promise<void>
  await act(async () => {
    completion = result.current
      .waitForFinish(async () => {
        await accepted.promise
        result.current.track([], queued)
      })
      .then(
        (success) => {
          outcomes.push(success)
        },
        (failure) => {
          outcomes.push(failure)
        }
      )
  })
  const finish = () => ipc.attachments[0].resolve(terminal(topic, status))
  if (beforeAck) await act(async () => finish())
  await act(async () => accepted.resolve())
  if (!beforeAck) await act(async () => finish())
  await waitFor(() => expect(outcomes).toEqual([status === 'done' ? true : error]))
  await completion
})

// Ordinary queued errors must show recovery feedback without any raw ai.stream.error event.
it.each(['error', 'unresolved'] as const)('reports an ordinary queued %s failure once', async (status) => {
  const ipc = projectionIpc()
  const topic = `queued-notification-${status}`
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useTopicCompletion(topic, [], feedback.onFinish)
    return feedback
  })
  act(() => result.current.track([], queued))
  await act(async () => ipc.attachments[0].resolve(terminal(topic, status)))
  await waitFor(() => expect(toast.errorFromException).toHaveBeenCalledWith(error, expect.anything()))
  act(() => ipc.emit(ipc.attachments[0].subscriptionId, { ...terminal(topic, status), patches: [], order: ['reply'] }))
  expect(toast.errorFromException).toHaveBeenCalledTimes(1)
})

it('uses neutral unknown fallback rather than stream interruption when isError arrives without data-error, and preserves data-error when present', async () => {
  const { result } = renderHook(() => useConversationErrorToasts('topic-missing-part'))

  act(() => {
    result.current.track([{ executionId: 'p::m', attemptId: 1, anchorMessageId: 'reply-1' }], [])
    result.current.onFinish('p::m', {
      attemptId: 1,
      message: { id: 'reply-1', role: 'assistant', parts: [] },
      isError: true,
      isAbort: false
    })
  })

  await waitFor(() => expect(toast.errorFromException).toHaveBeenCalledTimes(1))
  const fallbackError = vi.mocked(toast.errorFromException).mock.calls[0][0]
  expect(fallbackError).toBeInstanceOf(Error)
  expect((fallbackError as Error).message).not.toBe(i18n.t('error.diagnosis.stream'))
  expect((fallbackError as Error).message).toBe(i18n.t('error.diagnosis.unknown'))

  const providerError = {
    name: 'Error',
    message: '400 due to tool use concurrency issues.',
    stack: null,
    streamStage: 'response-stream'
  }
  act(() => {
    result.current.track([{ executionId: 'p::m', attemptId: 2, anchorMessageId: 'reply-2' }], [])
    result.current.onFinish('p::m', {
      attemptId: 2,
      message: { id: 'reply-2', role: 'assistant', parts: [{ type: 'data-error', data: providerError }] },
      isError: true,
      isAbort: false
    })
  })

  await waitFor(() => expect(toast.errorFromException).toHaveBeenCalledTimes(2))
  expect(vi.mocked(toast.errorFromException).mock.calls[1][0]).toBe(providerError)
})
