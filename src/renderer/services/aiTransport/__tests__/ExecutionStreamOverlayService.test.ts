import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { afterEach, expect, it, vi } from 'vitest'

import type {
  MessageProjectionUpdate,
  MessageProjectionView,
  ProjectedExecution,
  TopicProjectionState
} from '@shared/ai/messageProjection'

import { ExecutionStreamOverlayService } from '../ExecutionStreamOverlayService'
import { messageProjectionService } from '../MessageProjectionService'

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
afterEach(() => vi.restoreAllMocks())
function execution(attemptId: number, status: ProjectedExecution['status'] = 'active'): ProjectedExecution {
  return { executionId: 'p::m', attemptId, anchorMessageId: 'anchor', messageId: 'anchor', status }
}
function view(topicId: string, attemptId: number): MessageProjectionView<TopicProjectionState> {
  return {
    kind: 'topic',
    topicId,
    revision: 0,
    executions: [execution(attemptId)],
    messages: [{ id: 'anchor', role: 'assistant', parts: [{ type: 'text', text: 'prefix', state: 'streaming' }] }]
  }
}
function update(
  topicId: string,
  attemptId: number,
  revision: number,
  text: string,
  status: ProjectedExecution['status'] = 'active'
): MessageProjectionUpdate<TopicProjectionState> {
  return {
    kind: 'topic',
    topicId,
    revision,
    executions: [execution(attemptId, status)],
    patches: [{ type: 'append', messageId: 'anchor', part: 0, text }],
    order: ['anchor']
  }
}

// Finishing one turn must retain its readable frame until DB handoff, without double-firing completion.
it('retains terminal content, deduplicates completion, and protects a newer attempt from delayed reset', async () => {
  const ipc = projectionIpc()
  const service = new ExecutionStreamOverlayService()
  const topic = 'terminal-topic'
  const consumer = {}
  service.acquire(topic)
  const finishes: string[] = []
  service.onFinish(topic, (_id, event) => {
    finishes.push(`${event.attemptId}:${(event.message.parts[0] as { text: string }).text}`)
  })
  const attachment = ipc.attachments[0]
  attachment.resolve(view(topic, 1))
  await flush()
  const terminal = update(topic, 1, 1, ' final', 'done')
  ipc.emit(attachment.subscriptionId, terminal)
  ipc.emit(attachment.subscriptionId, terminal)
  expect(finishes).toEqual(['1:prefix final'])
  expect(service.getView(topic).overlay.anchor[0]).toMatchObject({ text: 'prefix final' })
  service.reset(topic)
  expect(service.getView(topic).liveAssistants).toEqual([])
  ipc.emit(attachment.subscriptionId, {
    ...update(topic, 2, 2, ''),
    patches: [{ type: 'message', message: { id: 'anchor', role: 'assistant', parts: [{ type: 'text', text: 'new' }] } }]
  })
  service.reset(topic)
  expect(service.getView(topic).overlay.anchor[0]).toMatchObject({ text: 'new' })
  service.release(topic, consumer)
})

// No successful handoff is allowed when the source reports a failed archive write.
it('keeps unresolved output visible and never reports it as a successful finish', async () => {
  const ipc = projectionIpc()
  const service = new ExecutionStreamOverlayService()
  const topic = 'write-failure'
  service.acquire(topic)
  const finishes: unknown[] = []
  service.onFinish(topic, (_id, event) => finishes.push(event))
  ipc.attachments[0].resolve(view(topic, 3))
  await flush()
  ipc.emit(ipc.attachments[0].subscriptionId, update(topic, 3, 1, ' readable', 'unresolved'))
  service.reset(topic)
  expect(service.getView(topic).overlay.anchor[0]).toMatchObject({ text: 'prefix readable' })
  expect(finishes).toEqual([])
  service.release(topic, {})
})

it('observes once for two consumers and restores current content on remount', async () => {
  const ipc = projectionIpc()
  const service = new ExecutionStreamOverlayService()
  const topic = 'shared-topic'
  const a = {},
    b = {}
  service.acquire(topic)
  service.acquire(topic)
  ipc.attachments[0].resolve(view(topic, 4))
  await flush()
  expect(ipc.attachments).toHaveLength(1)
  service.release(topic, a)
  expect(ipc.detached).toEqual([])
  service.release(topic, b)
  service.acquire(topic)
  ipc.attachments[1].resolve({
    ...view(topic, 4),
    revision: 10,
    messages: [{ id: 'anchor', role: 'assistant', parts: [{ type: 'text', text: 'advanced while hidden' }] }]
  })
  await flush()
  expect(service.getView(topic).overlay.anchor[0]).toMatchObject({ text: 'advanced while hidden' })
  service.release(topic, a)
})

it('shows the existing baseline when another consumer attached before the overlay', async () => {
  const ipc = projectionIpc()
  const topic = 'already-observed-topic'
  const stop = messageProjectionService.subscribe({ kind: 'topic', topicId: topic }, () => {})
  ipc.attachments[0].resolve(view(topic, 5))
  await flush()

  const service = new ExecutionStreamOverlayService()
  service.acquire(topic)
  expect(service.getView(topic).overlay.anchor?.[0]).toMatchObject({ text: 'prefix' })
  service.release(topic, {})
  stop()
})
