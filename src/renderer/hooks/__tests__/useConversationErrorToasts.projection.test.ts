import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { MessageProjectionView, TopicProjectionState } from '@shared/ai/messageProjection'

import { useConversationErrorToasts } from '../useConversationErrorToasts'
import { useExecutionOverlay } from '../useExecutionOverlay'

afterEach(() => vi.restoreAllMocks())

const queued = [{ id: 'queued-user', role: 'user' as const, parts: [] }]
const error = { name: 'Error', message: 'queued execution failed', stack: '' }
function terminal(topicId: string, failed: boolean): MessageProjectionView<TopicProjectionState> {
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
        status: failed ? 'error' : 'done'
      }
    ],
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        parts: failed ? [{ type: 'data-error', data: error }] : [{ type: 'text', text: 'answer' }]
      }
    ]
  }
}

// A queued ACK has no assistant attempt; only the projected user identity can settle its waiter.
it.each([
  { beforeAck: false, failed: false },
  { beforeAck: false, failed: true },
  { beforeAck: true, failed: false },
  { beforeAck: true, failed: true }
])('settles queued recovery from projection alone: %j', async ({ beforeAck, failed }) => {
  const ipc = projectionIpc()
  const topic = `queued-${beforeAck}-${failed}`
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useExecutionOverlay(topic, [], { onFinish: feedback.onFinish })
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
  const finish = () => ipc.attachments[0].resolve(terminal(topic, failed))
  if (beforeAck) await act(async () => finish())
  await act(async () => accepted.resolve())
  if (!beforeAck) await act(async () => finish())
  await waitFor(() => expect(outcomes).toEqual([failed ? error : true]))
  await completion
})

// Ordinary queued errors must show recovery feedback without any raw ai.stream.error event.
it('reports an ordinary queued failure once from its projected terminal', async () => {
  const ipc = projectionIpc()
  const topic = 'queued-notification'
  const { result } = renderHook(() => {
    const feedback = useConversationErrorToasts(topic)
    useExecutionOverlay(topic, [], { onFinish: feedback.onFinish })
    return feedback
  })
  act(() => result.current.track([], queued))
  await act(async () => ipc.attachments[0].resolve(terminal(topic, true)))
  await waitFor(() => expect(toast.errorFromException).toHaveBeenCalledWith(error, expect.anything()))
  act(() => ipc.emit(ipc.attachments[0].subscriptionId, { ...terminal(topic, true), patches: [], order: ['reply'] }))
  expect(toast.errorFromException).toHaveBeenCalledTimes(1)
})
