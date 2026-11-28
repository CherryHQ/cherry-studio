import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { messageProjectionService } from '@renderer/services/aiTransport'
import { messagePartsAt, replyParts } from '@renderer/utils/message/messagePartRows'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { useAgentToolParts } from '../useAgentToolParts'

afterEach(() => vi.restoreAllMocks())

it('updates only the owned reply and gives it back to history while the transport still holds the old row', async () => {
  const ipc = projectionIpc()
  const sessionId = 'tool-handoff'
  const target = { kind: 'topic' as const, topicId: buildAgentSessionTopicId(sessionId) }
  const stop = messageProjectionService.subscribe(target, () => {})
  const accepts = (part: CherryMessagePart) => part.type === 'data-compaction-anchor'
  const marker: CherryMessagePart = { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } }
  const row: CherryUIMessage = { id: 'reply', role: 'assistant', partIds: ['a'], parts: [{ type: 'text', text: 'A' }] }
  const committed: CherryMessagePart[] = [{ type: 'text', text: 'Edited history' }]
  const history = new Proxy(
    { reply: committed },
    {
      ownKeys: () => {
        throw new Error('enumerated history')
      }
    }
  )
  const attachment = ipc.attachments[0]
  await act(async () => attachment.resolve({ ...target, revision: 0, executions: [], messages: [row] }))
  const hook = renderHook(({ rows }) => useAgentToolParts(sessionId, rows, accepts), {
    initialProps: { rows: replyParts(history, [row]) }
  })
  try {
    expect(messagePartsAt(hook.result.current, 'reply')).toEqual([])
    act(() =>
      ipc.emit(attachment.subscriptionId, {
        kind: 'topic',
        type: 'parts',
        revision: 1,
        patches: [{ type: 'part-add', partId: 'marker', placement: { messageId: 'reply', pos: 2 }, part: marker }]
      })
    )
    expect(messagePartsAt(hook.result.current, 'reply')).toEqual([marker])
    hook.rerender({ rows: replyParts(history, []) })
    expect(messagePartsAt(hook.result.current, 'reply')).toBe(committed)
  } finally {
    hook.unmount()
    stop()
  }
})
