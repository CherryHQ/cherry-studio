import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { createOverlayRefreshHandoff } from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { MessageProjectionView } from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import { useExecutionOverlay } from '../useExecutionOverlay'
import { useTopicOverlayHandoffOnTerminal } from '../useTopicStreamStatus'

afterEach(() => vi.restoreAllMocks())
const base = (topicId: string, text: string): MessageProjectionView => ({
  kind: 'topic',
  topicId,
  revision: 0,
  executions: [{ executionId: 'p::m', attemptId: 1, anchorMessageId: 'a', messageId: 'a', status: 'active' }],
  messages: [{ id: 'a', role: 'assistant', parts: [{ type: 'text', text }] }]
})

// The old topic's async attach must not put its text into the newly selected topic.
it('isolates topic switches and uses the Main baseline without renderer history seeds', async () => {
  const ipc = projectionIpc()
  const hook = renderHook(({ topic }) => useExecutionOverlay(topic, []), { initialProps: { topic: 'hook-a' } })
  hook.rerender({ topic: 'hook-b' })
  await act(async () => {
    ipc.attachments[0].resolve(base('hook-a', 'old'))
    ipc.attachments[1].resolve(base('hook-b', 'new'))
  })
  expect(hook.result.current.liveAssistants[0].parts[0]).toMatchObject({ text: 'new' })
  act(() =>
    ipc.emit(ipc.attachments[0].subscriptionId, {
      kind: 'topic',
      topicId: 'hook-a',
      executions: [],
      revision: 1,
      patches: [{ type: 'append', messageId: 'a', part: 0, text: 'stale' }],
      order: ['a']
    })
  )
  expect(hook.result.current.liveAssistants[0].parts[0]).toMatchObject({ text: 'new' })
  hook.unmount()
})

// A retained terminal baseline must not override saved edits or resurrect deleted replies on attachment.
it.each([
  { statusFirst: true, deleted: false },
  { statusFirst: false, deleted: false },
  { statusFirst: true, deleted: true },
  { statusFirst: false, deleted: true }
])('hands a newly attached terminal overlay back to refreshed history: %j', async ({ statusFirst, deleted }) => {
  const ipc = projectionIpc()
  const topic = `terminal-baseline-${statusFirst}-${deleted}`
  const setDone = () =>
    MockUseCacheUtils.setSharedCacheValue(`topic.stream.statuses.${topic}`, {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 1
    })
  if (statusFirst) setDone()
  const saved: CherryUIMessage[] = deleted
    ? []
    : [{ id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'saved edit' }] }]
  const refreshed = Promise.withResolvers<void>()
  const hook = renderHook(() => {
    const overlay = useExecutionOverlay(topic, [])
    useTopicOverlayHandoffOnTerminal(
      topic,
      createOverlayRefreshHandoff(() => refreshed.promise, overlay.reset),
      overlay.liveAssistants
    )
    return mergeMessagesById(saved, overlay.liveAssistants)
  })
  await act(async () =>
    ipc.attachments[0].resolve({
      ...base(topic, 'old answer'),
      kind: 'topic',
      topicId: topic,
      executions: [{ executionId: 'p::m', attemptId: 1, messageId: 'a', status: 'done' }]
    })
  )
  if (!statusFirst)
    act(() => {
      setDone()
      hook.rerender()
    })
  expect(hook.result.current[0].parts[0]).toMatchObject({ text: 'old answer' })
  await act(async () => refreshed.resolve())
  await waitFor(() => expect(hook.result.current).toEqual(saved))
  hook.unmount()
})

// A refresh racing a new attempt or a failed archive must not discard the only readable output.
it.each(['active', 'unresolved'] as const)(
  'retains %s projection content during terminal history handoff',
  async (status) => {
    const ipc = projectionIpc()
    const topic = `keep-${status}`
    MockUseCacheUtils.setSharedCacheValue(`topic.stream.statuses.${topic}`, {
      status: 'error',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 1
    })
    const hook = renderHook(() => {
      const overlay = useExecutionOverlay(topic, [])
      useTopicOverlayHandoffOnTerminal(
        topic,
        createOverlayRefreshHandoff(async () => {}, overlay.reset),
        overlay.liveAssistants
      )
      return overlay.liveAssistants
    })
    await act(async () =>
      ipc.attachments[0].resolve({
        ...base(topic, 'unsaved answer'),
        kind: 'topic',
        topicId: topic,
        executions: [{ executionId: 'p::m', attemptId: 2, messageId: 'a', status }]
      })
    )
    expect(hook.result.current[0].parts[0]).toMatchObject({ text: 'unsaved answer' })
    hook.unmount()
  }
)
