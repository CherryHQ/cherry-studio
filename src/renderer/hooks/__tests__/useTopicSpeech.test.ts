import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { messageProjectionService } from '@renderer/services/aiTransport'
import type { MessageProjectionView, TopicProjectionState } from '@shared/ai/messageProjection'

import { useTopicSpeech } from '../useTopicSpeech'

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
afterEach(() => vi.restoreAllMocks())
function view(topicId: string, attemptId: number): MessageProjectionView<TopicProjectionState> {
  return {
    kind: 'topic',
    topicId,
    revision: 0,
    executions: [{ executionId: 'p::m', attemptId, anchorMessageId: 'anchor', messageId: 'anchor', status: 'active' }],
    messages: [{ id: 'anchor', role: 'assistant', parts: [{ type: 'text', text: 'prefix', state: 'streaming' }] }]
  }
}
it('starts a late text listener with current content and then delivers only the addressed suffix', async () => {
  const ipc = projectionIpc()
  const topic = 'speech-topic'
  const release = messageProjectionService.subscribe({ kind: 'topic', topicId: topic }, () => {})
  const initial = view(topic, 1)
  const attachment = ipc.attachments[0]
  attachment.resolve({ ...initial, messages: [{ ...initial.messages[0], partIds: ['part'] }] })
  await flush()
  const append = (revision: number, text: string) =>
    ipc.emit(attachment.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision,
      patches: [{ type: 'part-append', partId: 'part', text }]
    })
  const disabled = renderHook(() =>
    useTopicSpeech(topic, [], false, () => {
      throw new Error('Speech is disabled')
    })
  )
  const reads = vi.spyOn(messageProjectionService, 'getSnapshot')
  append(1, ' A')
  expect(reads).not.toHaveBeenCalled()
  disabled.unmount()
  const content = vi.fn<Parameters<typeof useTopicSpeech>[3]>()
  const { unmount: off } = renderHook(() => useTopicSpeech(topic, [], true, content))
  expect(content.mock.calls[0][1]).toMatchObject({ type: 'snapshot', message: { parts: [{ text: 'prefix A' }] } })
  content.mockClear()
  const fullReads = vi.spyOn(messageProjectionService, 'readParts')
  append(2, ' B')
  expect(content.mock.calls).toEqual([
    [
      'p::m',
      {
        type: 'text-append',
        attemptId: 1,
        messageId: 'anchor',
        partId: 'part',
        offset: 8,
        text: ' B',
        turnOrigin: undefined
      }
    ]
  ])
  expect(fullReads).not.toHaveBeenCalled()
  off()
  release()
})

it('anchors a new speech block to the preceding text and replays the same order to a late listener', async () => {
  const ipc = projectionIpc()
  const topic = 'speech-middle'
  const release = messageProjectionService.subscribe({ kind: 'topic', topicId: topic }, () => {})
  const initial = view(topic, 1)
  const attachment = ipc.attachments[0]
  attachment.resolve({ ...initial, messages: [{ ...initial.messages[0], parts: [], partIds: [] }] })
  await flush()
  const early = vi.fn<Parameters<typeof useTopicSpeech>[3]>()
  const { unmount: off } = renderHook(() => useTopicSpeech(topic, [], true, early))
  early.mockClear()
  ipc.emit(attachment.subscriptionId, {
    kind: 'topic',
    type: 'parts',
    revision: 1,
    patches: [
      { type: 'part-open', messageId: 'anchor', partId: 'first', kind: 'text', pos: 1 },
      { type: 'part-open', messageId: 'anchor', partId: 'thought', kind: 'reasoning', pos: 2 },
      { type: 'part-open', messageId: 'anchor', partId: 'middle', kind: 'text', pos: 3 },
      { type: 'part-open', messageId: 'anchor', partId: 'last', kind: 'text', pos: 4 },
      { type: 'part-append', partId: 'middle', text: 'Middle.' }
    ]
  })
  expect(early.mock.calls.map(([, event]) => event)).toMatchObject([
    { type: 'text-open', partId: 'first', afterTextPartId: undefined },
    { type: 'text-open', partId: 'middle', afterTextPartId: 'first' },
    { type: 'text-open', partId: 'last', afterTextPartId: 'middle' },
    { type: 'text-append', partId: 'middle', text: 'Middle.', offset: 0 }
  ])
  const late = vi.fn<Parameters<typeof useTopicSpeech>[3]>()
  const { unmount: stopLate } = renderHook(() => useTopicSpeech(topic, [], true, late))
  expect(late.mock.calls[0][1]).toMatchObject({
    type: 'snapshot',
    message: {
      partIds: ['first', 'thought', 'middle', 'last'],
      parts: [{ type: 'text' }, { type: 'reasoning' }, { type: 'text', text: 'Middle.' }, { type: 'text' }]
    }
  })
  stopLate()
  off()
  release()
})
