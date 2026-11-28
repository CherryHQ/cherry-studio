import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { messageProjectionService } from '@renderer/services/aiTransport'
import type { CherryUIMessage } from '@shared/data/types/message'

import { useAgentTimeline } from '../useAgentTimeline'

afterEach(() => vi.restoreAllMocks())

it('publishes new segment membership but leaves the list snapshot unchanged for text and late tool progress', async () => {
  const ipc = projectionIpc()
  const target = { kind: 'topic' as const, topicId: 'agent-session:timeline-subscription' }
  const tool = {
    type: 'dynamic-tool' as const,
    toolName: 'bash',
    toolCallId: 'call',
    state: 'input-available' as const,
    input: {}
  }
  const run: CherryUIMessage = { id: 'run', role: 'assistant', parts: [tool], partIds: ['tool'], partPositions: [2] }
  const steer: CherryUIMessage = {
    id: 'steer',
    role: 'user',
    parts: [{ type: 'text', text: 'Steer' }],
    timeline: { pos: 3 }
  }
  const messages = [run, steer]
  const parts = { run: run.parts, steer: steer.parts }
  const mounted = renderHook(() => useAgentTimeline(messages, parts, target))
  const attach = ipc.attachments[0]
  await act(async () => attach.resolve({ ...target, revision: 0, executions: [], messages: [run] }))
  act(() =>
    ipc.emit(attach.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 1,
      patches: [{ type: 'part-open', messageId: 'run', partId: 'after', kind: 'text', pos: 4 }]
    })
  )
  await waitFor(() =>
    expect(mounted.result.current.rows.map((row) => row.id)).toEqual(['run', 'steer', 'run:part:after'])
  )
  const before = mounted.result.current
  act(() =>
    ipc.emit(attach.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 2,
      patches: [
        { type: 'part-append', partId: 'after', text: 'New answer' },
        {
          type: 'part-put',
          partId: 'tool',
          part: { ...tool, state: 'output-available', preliminary: true, output: 'Progress' }
        }
      ]
    })
  )
  expect(mounted.result.current).toBe(before)
  expect(messageProjectionService.readPart(target, 'after')).toMatchObject({ text: 'New answer' })
  expect(messageProjectionService.readPart(target, 'tool')).toMatchObject({ output: 'Progress' })
  expect(mounted.result.current.rows[0].partIds).toEqual(['tool'])
  mounted.unmount()
  expect(ipc.detached).toContain(attach.subscriptionId)
})
