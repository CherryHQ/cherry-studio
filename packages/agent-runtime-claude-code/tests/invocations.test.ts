import { randomUUID } from 'node:crypto'

import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
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

it.each(['task_notification', 'task_updated'] as const)(
  'does not finalize an overlapping root response when a task emits %s',
  (subtype) => {
    const invocations = new ClaudeInvocations()
    const root = assistantMessage('session', [])
    const child = assistantMessage('session', [], { parent_tool_use_id: 'child-tool' })
    child.message.id = 'child-response'
    child.message.usage.output_tokens = 25
    invocations.accept(stream({ type: 'message_start', message: root.message }))
    invocations.accept(child)
    const completion: SDKMessage =
      subtype === 'task_notification'
        ? {
            type: 'system',
            subtype,
            task_id: 'task',
            tool_use_id: 'child-tool',
            status: 'completed',
            output_file: '',
            summary: '',
            uuid: randomUUID(),
            session_id: 'session'
          }
        : {
            type: 'system',
            subtype,
            task_id: 'task',
            patch: { status: 'completed' },
            uuid: randomUUID(),
            session_id: 'session'
          }
    const emitted = invocations.accept(completion)
    expect(emitted).toEqual(
      subtype === 'task_notification'
        ? [
            expect.objectContaining({
              responseId: 'child-response',
              usage: expect.objectContaining({ output_tokens: 25 })
            })
          ]
        : []
    )

    const final = invocations.accept(
      stream({
        type: 'message_delta',
        context_management: null,
        delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null, container: null },
        usage: { ...root.message.usage, output_tokens: 100 }
      })
    )
    expect(final).toMatchObject([{ responseId: root.message.id, usage: { output_tokens: 100 } }])
    expect(invocations.close().map((item) => item.responseId)).toEqual(
      subtype === 'task_updated' ? ['child-response'] : []
    )
  }
)

it('does not finalize an unfinished task response or an unrelated completed response on task notification', () => {
  const invocations = new ClaudeInvocations()
  const active = assistantMessage('session', [], { parent_tool_use_id: 'active-tool' })
  const other = assistantMessage('session', [], { parent_tool_use_id: 'other-tool' })
  other.message.id = 'other-response'
  invocations.accept(stream({ type: 'message_start', message: active.message }, 'active-tool'))
  invocations.accept(other)
  expect(
    invocations.accept({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task',
      tool_use_id: 'active-tool',
      status: 'completed',
      output_file: '',
      summary: '',
      uuid: randomUUID(),
      session_id: 'session'
    })
  ).toEqual([])
  active.message.usage.output_tokens = 100
  invocations.accept(active)
  expect(invocations.accept(stream({ type: 'message_stop' }, 'active-tool'))).toMatchObject([
    { responseId: active.message.id, usage: { output_tokens: 100 } }
  ])
  expect(invocations.close().map((item) => item.responseId)).toEqual(['other-response'])
})

it('does not promote provisional non-stream snapshots to final per-invocation counts', () => {
  const invocations = new ClaudeInvocations()
  const first = assistantMessage('session', [])
  first.message.stop_reason = null
  first.message.usage.output_tokens = 99
  const second = assistantMessage('session', [])
  second.message.id = 'second'
  second.message.stop_reason = null
  second.message.usage.output_tokens = 101
  expect(invocations.accept(first)).toEqual([])
  expect(invocations.accept(second)).toEqual([{ responseId: first.message.id, model: first.message.model }])
  expect(invocations.close()).toEqual([])
})

it('does not finalize an interrupted streaming invocation merely because another response starts', () => {
  const invocations = new ClaudeInvocations()
  const first = assistantMessage('session', [])
  first.message.stop_reason = null
  invocations.accept(stream({ type: 'message_start', message: first.message }))
  invocations.accept(first)
  const second = assistantMessage('session', [])
  second.message.id = 'second'
  expect(invocations.accept(stream({ type: 'message_start', message: second.message }))).toEqual([])
  expect(invocations.close()).toEqual([])
})

function result(usage: object, subtype = 'success'): SDKMessage {
  return {
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    usage,
    session_id: 'session',
    uuid: randomUUID()
  } as SDKMessage
}

it('keeps both non-streamed multi-invocation counts unavailable instead of guessing turn attribution', () => {
  const invocations = new ClaudeInvocations()
  const first = assistantMessage('session', [])
  first.message.stop_reason = null
  const second = assistantMessage('session', [])
  second.message.id = 'second'
  second.message.stop_reason = null
  invocations.accept(first)
  const emitted = [
    ...invocations.accept(second),
    ...invocations.accept(result({ input_tokens: 20, output_tokens: 30 }))
  ]
  expect(emitted).toHaveLength(2)
  expect(emitted.every((call) => call.usage === undefined)).toBe(true)
})

it('does not repair failed non-streamed result usage or include child invocations in a root total', () => {
  const invocations = new ClaudeInvocations()
  const root = assistantMessage('session', [])
  root.message.stop_reason = null
  const child = assistantMessage('session', [], { parent_tool_use_id: 'child' })
  child.message.id = 'child'
  child.message.usage.output_tokens = 7
  invocations.accept(root)
  invocations.accept(child)
  expect(invocations.accept(result({ input_tokens: 20, output_tokens: 30 }, 'error_during_execution'))).toEqual([])
  expect(invocations.close()).toMatchObject([{ responseId: 'child', usage: { output_tokens: 7 } }])
})
