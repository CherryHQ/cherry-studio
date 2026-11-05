import { randomUUID } from 'node:crypto'

import type { SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { ClaudeInvocations } from '../src/invocations'
import { assistantMessage } from './wireFixture'

function stream(
  event: SDKPartialAssistantMessage['event'],
  parentToolUseId: string | null = null
): SDKPartialAssistantMessage {
  return { type: 'stream_event', event, parent_tool_use_id: parentToolUseId, uuid: randomUUID(), session_id: 'session' }
}

it('merges native usage, preserves unreported counts, accepts zero, and emits each response once', () => {
  const invocations = new ClaudeInvocations()
  const assistant = assistantMessage('session', [])
  assistant.message.usage = {
    ...assistant.message.usage,
    input_tokens: 3,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 7,
    output_tokens: 0,
    speed: 'fast'
  }
  invocations.accept(stream({ type: 'message_start', message: assistant.message }))
  assistant.message.usage = {
    ...assistant.message.usage,
    input_tokens: 13,
    cache_read_input_tokens: 19,
    cache_creation_input_tokens: 17,
    output_tokens: 11
  }
  invocations.accept(assistant)
  const completed = invocations.accept(
    stream({
      type: 'message_delta',
      context_management: null,
      delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null, container: null },
      usage: {
        input_tokens: null,
        output_tokens: 23,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: 0,
        iterations: null,
        server_tool_use: null
      }
    })
  )
  expect(completed).toMatchObject([
    {
      responseId: assistant.message.id,
      usage: {
        input_tokens: 13,
        output_tokens: 23,
        cache_read_input_tokens: 19,
        cache_creation_input_tokens: 0,
        speed: 'fast'
      }
    }
  ])
  expect(invocations.accept(assistant)).toEqual([])
  expect(invocations.accept(stream({ type: 'message_stop' }))).toEqual([])
  expect(invocations.close()).toEqual([])
})

it('keeps interleaved root and child response usage separate', () => {
  const invocations = new ClaudeInvocations()
  const root = assistantMessage('session', [])
  const child = assistantMessage('session', [], { parent_tool_use_id: 'child-tool' })
  child.message.id = 'msg_child'
  root.message.usage.output_tokens = 7
  child.message.usage.output_tokens = 11
  invocations.accept(root)
  invocations.accept(child)
  expect(invocations.accept(stream({ type: 'message_stop' }, 'child-tool'))).toMatchObject([
    { responseId: child.message.id, usage: { output_tokens: 11 } }
  ])
  expect(invocations.accept(stream({ type: 'message_stop' }))).toMatchObject([
    { responseId: root.message.id, usage: { output_tokens: 7 } }
  ])
})

it('does not replace complete usage with a replayed assistant block reporting fewer tokens', () => {
  const invocations = new ClaudeInvocations()
  const assistant = assistantMessage('session', [])
  assistant.message.usage = { ...assistant.message.usage, input_tokens: 13, output_tokens: 19 }
  invocations.accept(assistant)
  invocations.accept({
    ...assistant,
    message: { ...assistant.message, usage: { ...assistant.message.usage, input_tokens: 2, output_tokens: 3 } }
  })
  expect(invocations.close()).toMatchObject([
    { responseId: assistant.message.id, usage: { input_tokens: 13, output_tokens: 19 } }
  ])
})

it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('does not report invalid token usage (%s)', (outputTokens) => {
  const invocations = new ClaudeInvocations()
  const assistant = assistantMessage('session', [])
  assistant.message.usage.output_tokens = outputTokens
  invocations.accept(assistant)
  expect(invocations.close()).toEqual([{ responseId: assistant.message.id, model: assistant.message.model }])
})

it('does not charge an unfinished stream from its initial usage alone', () => {
  const invocations = new ClaudeInvocations()
  const assistant = assistantMessage('session', [])
  invocations.accept(stream({ type: 'message_start', message: assistant.message }))
  expect(invocations.close()).toEqual([])
})
