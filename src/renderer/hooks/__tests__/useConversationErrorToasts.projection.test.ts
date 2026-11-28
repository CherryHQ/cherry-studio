import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

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

// A runtime failure can finish without a structured error part (issue #24257): the
// trailing text then carries the only detail and must be surfaced as-is, instead of
// the generic stream diagnosis that misreads local failures as network interruptions.
it('surfaces the trailing text detail when an error finish carries no data-error part', async () => {
  const ipc = projectionIpc()
  const topic = 'unstructured-error-detail'
  const detail = 'Claude Code open: native-storage-unavailable'
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useTopicCompletion(topic, [], feedback.onFinish)
    return feedback
  })
  act(() => result.current.track([], queued))
  const view = terminal(topic, 'error')
  view.messages[0].parts = [{ type: 'text', text: detail }]
  await act(async () => ipc.attachments[0].resolve(view))
  await waitFor(() =>
    expect(toast.errorFromException).toHaveBeenCalledWith(
      expect.objectContaining({ message: detail }),
      expect.anything()
    )
  )
})

it('falls back to the stream diagnosis only when an error finish carries no detail at all', async () => {
  const ipc = projectionIpc()
  const topic = 'unstructured-error-bare'
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useTopicCompletion(topic, [], feedback.onFinish)
    return feedback
  })
  act(() => result.current.track([], queued))
  const view = terminal(topic, 'error')
  view.messages[0].parts = []
  await act(async () => ipc.attachments[0].resolve(view))
  await waitFor(() =>
    expect(toast.errorFromException).toHaveBeenCalledWith(
      expect.objectContaining({ message: '响应传输中断，请检查网络稳定性或重试' }),
      expect.anything()
    )
  )
})
