import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'

import { ClaudePromptSuggestion } from '../ClaudePromptSuggestion'

const result: SDKResultSuccess = {
  type: 'result',
  subtype: 'success',
  duration_ms: 1,
  duration_api_ms: 1,
  is_error: false,
  num_turns: 1,
  result: 'fixed',
  stop_reason: 'end_turn',
  total_cost_usd: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    inference_geo: '',
    iterations: [],
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    speed: 'standard'
  },
  modelUsage: {},
  permission_denials: [],
  session_id: 'native',
  uuid: crypto.randomUUID()
}
const suggestion: ClaudeObservation = {
  events: [],
  retracted: [],
  native: [
    {
      source: 'live',
      message: {
        type: 'prompt_suggestion',
        suggestion: 'run the tests',
        uuid: crypto.randomUUID(),
        session_id: 'native'
      }
    }
  ]
}
function completed(state: ClaudePromptSuggestion, isError = false) {
  state.accept({ events: [], retracted: [], native: [{ source: 'live', message: { ...result, is_error: isError } }] })
}

it('waits past result for the native suggestion and retains it for the composer', async () => {
  const state = new ClaudePromptSuggestion()
  completed(state)
  const pending = state.read(new AbortController().signal)
  state.accept(suggestion)
  expect(await pending).toBe('run the tests')
  expect(await state.read(new AbortController().signal)).toBe('run the tests')
})

it('does not revive suggestions after input, failure or observation recovery', async () => {
  const state = new ClaudePromptSuggestion()
  completed(state)
  const pending = state.read(new AbortController().signal)
  state.clear()
  state.accept(suggestion)
  expect(await pending).toBe('')
  expect(await state.read(new AbortController().signal)).toBe('')
  completed(state, true)
  state.accept(suggestion)
  expect(await state.read(new AbortController().signal)).toBe('')
  completed(state)
  state.accept({ ...suggestion, events: [{ type: 'gap', reason: 'overflow' }] })
  expect(await state.read(new AbortController().signal)).toBe('')
})

it('releases a cancelled wait when native generation is suppressed', async () => {
  const state = new ClaudePromptSuggestion()
  completed(state)
  const controller = new AbortController()
  const pending = state.read(controller.signal)
  controller.abort()
  expect(await pending).toBe('')
})

it('ignores events from a different native session', async () => {
  const state = new ClaudePromptSuggestion()
  completed(state)
  const controller = new AbortController()
  const pending = state.read(controller.signal)
  state.accept({
    ...suggestion,
    native: [
      {
        source: 'live',
        message: {
          type: 'prompt_suggestion',
          suggestion: 'wrong session',
          uuid: crypto.randomUUID(),
          session_id: 'different'
        }
      }
    ]
  })
  state.accept(suggestion)
  expect(await pending).toBe('run the tests')
})
