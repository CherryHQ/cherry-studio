import { randomUUID } from 'node:crypto'

import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../../types'
import { ClaudeConnection } from '../ClaudeConnection'

const sdk = vi.hoisted(() => ({ messages: [] as SDKMessage[] }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => ({
    supportedCommands: async () => [],
    supportedModels: async () => [],
    close() {},
    async *[Symbol.asyncIterator]() {
      yield* sdk.messages
    }
  })
}))
vi.mock('../launch', () => ({ resolveLocalAgentLaunch: async () => ({ executable: 'claude', args: [], env: {} }) }))

const input = { message: { data: { parts: [{ type: 'text', text: 'hello' }] } } } as AgentRuntimeUserInput

function result(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'native-session',
    usage: { input_tokens: 3, output_tokens: 5 },
    stop_reason: 'end_turn',
    ...overrides
  } as SDKMessage
}

function stream(event: SDKPartialAssistantMessage['event'], parent: string | null = null): SDKPartialAssistantMessage {
  return { type: 'stream_event', parent_tool_use_id: parent, event, session_id: 'native-session', uuid: randomUUID() }
}

async function run() {
  const connection = new ClaudeConnection('session', 'agent', {
    protocol: 'claude',
    enabled: true,
    args: [],
    env: {}
  })
  const events: AgentRuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of connection.events) events.push(event)
  })()
  try {
    await connection.start('/tmp')
    await connection.send(input)
  } finally {
    await connection.close()
    await drained
  }
  return {
    events,
    info: connection.localSessionInfo,
    chunks: events.flatMap((event) => (event.type === 'chunk' ? [event.chunk] : []))
  }
}

beforeEach(() => {
  sdk.messages = []
})

describe('native Claude protocol mapping', () => {
  it('preserves thinking and child tool ownership without stamping a provider model identity', async () => {
    sdk.messages = [
      stream({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check first' } }),
      stream({ type: 'content_block_stop', index: 0 }),
      stream(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
        'parent-tool'
      ),
      stream(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Child answer' } },
        'parent-tool'
      ),
      stream({ type: 'content_block_stop', index: 0 }, 'parent-tool'),
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-tool',
        message: {
          model: 'child-model',
          content: [{ type: 'tool_use', id: 'child-tool', name: 'Read', input: { path: '/tmp/file' } }]
        }
      } as SDKMessage,
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { model: 'native-model', content: [{ type: 'text', text: 'Main answer' }] }
      } as SDKMessage,
      result()
    ]
    const { events, chunks, info } = await run()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', delta: 'Check first' }))
    const childText = chunks.find(
      (chunk) =>
        chunk.type === 'text-start' && chunk.providerMetadata?.['claude-code']?.parentToolCallId === 'parent-tool'
    )
    expect(childText).toBeDefined()
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-input-start',
        toolCallId: 'child-tool',
        providerMetadata: expect.objectContaining({
          'claude-code': expect.objectContaining({ parentToolCallId: 'parent-tool' })
        })
      })
    )
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Main answer' }))
    expect(info.activeModel).toEqual({ id: 'native-model' })
    expect(chunks.filter((chunk) => chunk.type === 'finish')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    for (const chunk of chunks) {
      if (chunk.type === 'message-metadata') expect(chunk.messageMetadata).not.toHaveProperty('modelId')
    }
  })

  it('continues past a resumed task notification and emits the actual user turn answer', async () => {
    sdk.messages = [
      result({ origin: { kind: 'task-notification' } }),
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { model: 'native-model', content: [{ type: 'text', text: 'Actual answer' }] }
      } as SDKMessage,
      result({ stop_reason: 'max_tokens' })
    ]
    const { chunks, events } = await run()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Actual answer' }))
    expect(chunks).toContainEqual({ type: 'finish', finishReason: 'length' })
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    expect(events).toContainEqual({ type: 'resume-token', token: 'native-session' })
  })

  it('reports SDK terminal API failures even when is_error is false', async () => {
    sdk.messages = [result({ terminal_reason: 'api_error', api_error_status: 429, result: 'Rate limited' })]
    const { events, chunks } = await run()
    expect(events).toContainEqual({ type: 'error', error: expect.objectContaining({ message: 'Rate limited' }) })
    expect(chunks.some((chunk) => chunk.type === 'finish')).toBe(false)
    expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
  })
})
