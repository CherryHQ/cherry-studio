import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { serializeError } from '@main/ai/utils/serializeError'

import type { AgentRuntimeEvent } from '../../types'
import { ClaudeCodeResultError, ClaudeRuntimeState } from '../ClaudeRuntimeState'

function fixture() {
  const events: AgentRuntimeEvent[] = []
  const state = new ClaudeRuntimeState((event) => events.push(event))
  const accept = (value: object) =>
    state.accept({ session_id: 'native', uuid: crypto.randomUUID(), ...value } as SDKMessage)
  const result = (extra: object = {}) => ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    usage: { input_tokens: 3, output_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 },
    ...extra
  })
  return { events, state, accept, result }
}

describe('Claude native lifecycle', () => {
  // A replayed notification result must not finish the newly submitted user input.
  it('settles a task-notification result only when it belongs to an autonomous wake', () => {
    const f = fixture()
    f.state.beginTurn()
    expect(f.accept(f.result({ origin: { kind: 'task-notification' } }))).toBeUndefined()
    expect(f.state.isTurnActive).toBe(true)
    f.accept(f.result())
    f.accept({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'wake' }] } })
    expect(f.events).toContainEqual({
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' }
    })
    expect(f.accept(f.result({ origin: { kind: 'task-notification' } }))).toMatchObject({ subtype: 'success' })
    expect(f.events.at(-1)).toEqual({ type: 'autonomous-turn-state', state: 'finished' })
    expect(f.state.isTurnActive).toBe(false)
  })

  // Empty membership can precede a wake; only authoritative idle releases the connection.
  it('keeps background work alive through foreground completion and releases at native idle', () => {
    const f = fixture()
    f.state.beginTurn()
    f.accept({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'child', task_type: 'local_agent', description: 'work' }]
    })
    f.accept(f.result())
    f.accept({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
    expect(f.events.filter((event) => event.type === 'background-work-state')).toEqual([
      { type: 'background-work-state', active: true, awaitingReply: false }
    ])
    f.accept({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
    expect(f.events.at(-1)).toEqual({ type: 'background-work-state', active: false })
  })

  it('keeps task navigation when a launch receipt arrives after membership', () => {
    const f = fixture()
    f.state.beginTurn()
    f.accept({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: {} }] }
    })
    f.accept({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'child', task_type: 'subagent', description: 'work' }]
    })
    f.accept({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'spawn',
            content: JSON.stringify({ status: 'async_launched', agentId: 'child' })
          }
        ]
      }
    })
    expect(f.events.at(-1)).toEqual({
      type: 'background-tasks',
      tasks: [{ id: 'child', type: 'subagent', description: 'work', toolCallId: 'spawn' }]
    })
  })

  it('does not treat child content as a root wake and keeps task status independent of a parent turn', () => {
    const f = fixture()
    f.accept({ type: 'assistant', parent_tool_use_id: 'spawn', message: { content: [] } })
    expect(f.state.isTurnActive).toBe(false)
    f.accept({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'child',
      tool_use_id: 'spawn',
      status: 'stopped',
      summary: 'partial'
    })
    expect(f.events).toContainEqual({
      type: 'background-task-event',
      data: expect.objectContaining({ taskId: 'child', toolUseId: 'spawn', status: 'stopped' })
    })
  })

  it('settles successful and failed compaction without requiring a boundary message', () => {
    const f = fixture()
    f.accept({ type: 'system', subtype: 'status', status: 'compacting' })
    f.accept({ type: 'system', subtype: 'status', status: null, compact_result: 'success' })
    f.accept({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'capacity' })
    expect(f.events).toEqual([
      { type: 'compaction-start' },
      { type: 'compaction-complete' },
      { type: 'compaction-error', error: 'capacity' }
    ])
  })

  // Losing typed status here would turn upstream HTTP errors into generic process exits.
  it.each([400, 401, 429, 503])('preserves HTTP %i and usage when a native result fails', (status) => {
    const f = fixture()
    f.state.beginTurn()
    expect(() =>
      f.accept(f.result({ is_error: true, api_error_status: status, terminal_reason: 'api_error', result: 'failed' }))
    ).toThrow(ClaudeCodeResultError)
    try {
      f.accept(f.result({ api_error_status: status, result: 'failed' }))
    } catch (error) {
      expect(serializeError(error)).toMatchObject({ statusCode: status })
    }
    expect(f.events.at(-1)).toMatchObject({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: { stats: { inputTokens: 21, outputTokens: 5, totalTokens: 26 } }
      }
    })
  })

  it('resets the thinking estimate across turns and never emits native body chunks', () => {
    const f = fixture()
    f.state.beginTurn()
    f.accept({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 4 })
    f.accept(f.result())
    expect(f.events.at(-1)).toMatchObject({
      chunk: { messageMetadata: { stats: { outputTokenDetails: { reasoningTokens: 4 } } } }
    })
    f.state.beginTurn()
    const result = f.accept(f.result()) as SDKResultMessage
    expect(result.type).toBe('result')
    expect(f.events.at(-1)).not.toMatchObject({
      chunk: { messageMetadata: { stats: { outputTokenDetails: { reasoningTokens: 4 } } } }
    })
    expect(
      f.events.filter((event) => event.type === 'chunk').every((event) => event.chunk.type === 'message-metadata')
    ).toBe(true)
  })
})
