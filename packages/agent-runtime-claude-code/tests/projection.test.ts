import { randomUUID } from 'node:crypto'

import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { claudeThread } from '../src'
import { ClaudeProjection } from '../src/projection'

it.each([false, true])('keeps omitted tool output retracted after archive reconciliation (error: %s)', (isError) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call: SessionMessage = {
    type: 'assistant',
    uuid: 'call-message',
    session_id: sessionId,
    parent_tool_use_id: null,
    parent_agent_id: null,
    message: { content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { path: '/document' } }] }
  }
  const result: SessionMessage = {
    ...call,
    type: 'user',
    uuid: 'result-message',
    message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'Withdrawn output', is_error: isError }] }
  }
  const summary: SessionMessage = {
    ...call,
    uuid: 'summary',
    message: { content: [{ type: 'text', text: 'Selected summary' }] }
  }
  projection.restore([call, result], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    state: isError ? 'output-error' : 'output-available'
  })

  const archive = projection.restore([summary], [{ type: 'assistant', retracted_message_uuids: [result.uuid] }])
  expect(archive.retracted).toEqual([result.uuid])
  expect(archive.content.map((message) => message.id)).toEqual([summary.uuid])
  expect(projection.feed.snapshot.coverage).toBe('retained-view')
  expect(projection.feed.snapshot.messages.map((message) => message.id)).toEqual([call.uuid, summary.uuid])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    type: 'dynamic-tool',
    toolCallId: 'call',
    input: { path: '/document' },
    state: 'input-available'
  })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')

  projection.restore([call, result, summary], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ state: 'input-available' })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')
})
