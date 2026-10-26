import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { MessageProjectionView } from '@shared/ai/messageProjection'

import { useExecutionOverlay } from '../useExecutionOverlay'

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
