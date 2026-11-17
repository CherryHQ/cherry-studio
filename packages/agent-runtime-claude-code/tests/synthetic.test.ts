import { randomUUID } from 'node:crypto'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { claudeThread } from '../src'
import { ClaudeControlState, type ClaudeControl } from '../src/control'
import { ClaudeInvocations } from '../src/invocations'
import { ClaudeProjection } from '../src/projection'
import { assistantMessage } from './wireFixture'

function message(text: string, model = '<synthetic>') {
  const result = assistantMessage('207995f5-3d2e-4da0-869e-15105be0138e', [{ type: 'text', text, citations: null }])
  result.message.model = model
  result.message.id = randomUUID()
  return result
}
function projection() {
  return new ClaudeProjection(claudeThread(runtimeId('backend'), '207995f5-3d2e-4da0-869e-15105be0138e'), (error) => {
    throw error
  })
}
it('drops only the synthetic interrupt placeholder in live and restored product content', () => {
  const live = projection(),
    restored = projection()
  const real = message('Real answer', 'claude'),
    closer = message('  No response requested.  ')
  for (const item of [real, closer]) live.publish(live.message(item))
  expect(live.feed.snapshot.messages.map((item) => item.id)).toEqual([real.uuid])
  const archive = restored.restore(
    [real, closer].map((item) => ({ ...item, parent_agent_id: null })),
    []
  )
  expect(restored.feed.snapshot.messages.map((item) => item.id)).toEqual([real.uuid])
  expect(archive.content.map((item) => item.id)).toEqual([real.uuid])
})
it.each([
  ['local command', '## Context usage\nSystem prompt: 1,024', '<synthetic>'],
  ['real model same words', 'No response requested.', 'claude'],
  ['near-match', 'No response requested. More detail.', '<synthetic>']
])('preserves %s output', (_label, text, model) => {
  const p = projection(),
    item = message(text, model)
  p.publish(p.message(item))
  expect(p.feed.snapshot.messages[0]).toMatchObject({ id: item.uuid, parts: [{ type: 'text', text }] })
})
it('does not discard meaningful non-text blocks beside the placeholder', () => {
  const p = projection(),
    item = message('No response requested.')
  item.message.content.push({ type: 'tool_use', id: 'call', name: 'Bash', input: {}, caller: { type: 'direct' } })
  p.publish(p.message(item))
  expect(p.feed.snapshot.messages[0].parts).toHaveLength(2)
})
it('does not open an autonomous turn for synthetic assistants or promote their fork checkpoint', () => {
  const events: ClaudeControl[] = [],
    control = new ClaudeControlState((event) => events.push(event))
  const real = message('Real', 'claude'),
    closer = message('No response requested.')
  control.accept(closer)
  expect(events).toEqual([])
  expect(control.isTurnActive).toBe(false)
  control.beginTurn()
  control.accept(real)
  closer.aborted = true
  control.accept(closer)
  expect(control.snapshot.aborted).toBe(true)
  control.accept({
    type: 'result',
    subtype: 'success',
    session_id: '207995f5-3d2e-4da0-869e-15105be0138e',
    usage: {},
    result: '',
    is_error: false
  } as SDKMessage)
  expect(events.find((event) => event.type === 'result')).toMatchObject({ messageUuid: real.uuid })
})
it('does not count synthetic assistant or stream-start usage and retains real usage', () => {
  const invocations = new ClaudeInvocations(),
    closer = message('No response requested.'),
    real = message('Real', 'claude')
  invocations.accept({
    type: 'stream_event',
    event: { type: 'message_start', message: closer.message },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: '207995f5-3d2e-4da0-869e-15105be0138e'
  })
  invocations.accept(closer)
  expect(invocations.close()).toEqual([])
  invocations.accept(real)
  expect(invocations.close()).toMatchObject([{ responseId: real.message.id, model: 'claude' }])
})
