import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { ClaudeControlState, type ClaudeControl } from '../src/control'

// A newly added SDK variant must receive an explicit owner before upgrading the dependency.
const systemMessages = {
  init: 'control: native session identity',
  compact_boundary: 'control: compaction and archive revision',
  status: 'control: compaction outcome',
  api_retry: 'control: retry status',
  control_request_progress: 'native-only: request progress does not settle input',
  model_refusal_fallback: 'content: native projection owns retractions',
  model_refusal_no_fallback: 'native-only: result owns terminal failure',
  local_command_output: 'content: owner correlates local command completion',
  hook_started: 'native-only: hook diagnostics do not settle input',
  hook_progress: 'native-only: hook diagnostics do not settle input',
  hook_response: 'native-only: hook diagnostics do not settle input',
  plugin_install: 'native-only: installation progress is not a reply',
  task_notification: 'control: task outcome',
  task_started: 'control: task identity and activity',
  task_updated: 'control: task patch',
  task_progress: 'control: task progress',
  background_tasks_changed: 'control: background occupancy',
  thinking_tokens: 'control: reasoning estimate',
  session_state_changed: 'control: background release barrier',
  worker_shutting_down: 'native-only: process exit owns shutdown',
  commands_changed: 'control: supported commands',
  notification: 'native-only: advisory notification',
  files_persisted: 'native-only: persistence diagnostic',
  memory_recall: 'native-only: recall diagnostic',
  elicitation_complete: 'native-only: interaction callback owns elicitation',
  permission_denied: 'content: native projection owns denied tool state',
  mirror_error: 'native-only: mirror diagnostic',
  informational: 'native-only: advisory content'
} satisfies Record<Extract<SDKMessage, { type: 'system' }>['subtype'], string>

const otherMessages = {
  assistant: 'content: projection and invocation owner',
  user: 'content: input membership and tool results',
  result: 'control: input outcome and completion',
  stream_event: 'content: projection and invocation owner',
  tool_progress: 'control: native retry status',
  auth_status: 'native-only: authentication diagnostic',
  tool_use_summary: 'native-only: summary does not replace tool results',
  rate_limit_event: 'native-only: retry and result own request outcome',
  prompt_suggestion: 'native-only: optional suggestion is not submitted input',
  conversation_reset: 'identity: owner replaces the native root'
} satisfies Record<Exclude<SDKMessage, { type: 'system' }>['type'], string>

it.each(
  [
    ...Object.entries(systemMessages).map(([subtype, route]) => ({ frame: { type: 'system', subtype }, route })),
    ...Object.entries(otherMessages).map(([type, route]) => ({ frame: { type }, route }))
  ].filter(({ route }) => route.startsWith('native-only:'))
)('does not settle a turn from $frame: $route', ({ frame }) => {
  const f = fixture()
  f.state.beginTurn()
  f.accept(frame)
  expect(f.state.isTurnActive).toBe(true)
  expect(f.events).toEqual([])
})

function fixture() {
  const events: ClaudeControl[] = []
  const state = new ClaudeControlState((event) => events.push(event))
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
      state: 'started'
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
    f.accept(f.result({ is_error: true, api_error_status: status, terminal_reason: 'api_error', result: 'failed' }))
    expect(f.events.at(-1)).toMatchObject({
      type: 'result',
      terminal: true,
      failure: { statusCode: status, terminalReason: 'api_error', message: 'failed' },
      usage: { input_tokens: 3, output_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 }
    })
    expect(f.state.isTurnActive).toBe(false)
  })

  it('resets the thinking estimate across turns and never emits native body chunks', () => {
    const f = fixture()
    f.state.beginTurn()
    f.accept({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 4 })
    f.accept(f.result())
    expect(f.events.at(-1)).toMatchObject({
      type: 'result',
      reasoningTokens: 4
    })
    f.state.beginTurn()
    const result = f.accept(f.result()) as SDKResultMessage
    expect(result.type).toBe('result')
    expect(f.events.at(-1)).not.toMatchObject({
      type: 'result',
      reasoningTokens: 4
    })
    expect(f.events.at(-1)).toMatchObject({ type: 'result', reasoningTokens: undefined })
  })
})
