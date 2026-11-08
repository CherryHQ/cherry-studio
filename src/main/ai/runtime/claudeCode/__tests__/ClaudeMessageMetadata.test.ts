import { randomUUID } from 'node:crypto'

import { expect, it, onTestFinished, vi } from 'vitest'

import { runtimeId, type RuntimeMessage } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'

import { ClaudeMessageMetadata } from '../ClaudeMessageMetadata'
import type { McpToolDisplayMetadata } from '../types'

async function project(message: RuntimeMessage, native: ClaudeObservation['native'] = []) {
  const metadata = new ClaudeMessageMetadata()
  const projection = new ThreadMessageProjection(
    { backendId: runtimeId('claude'), id: runtimeId('root') },
    metadata.decorate
  )
  const batch: ClaudeObservation = { events: [{ type: 'message.upsert', message }], native, retracted: [] }
  metadata.accept(batch)
  await projection.accept(batch.events[0])
  const messages = projection.snapshot().messages
  await projection.close()
  return messages
}

it('times each reasoning block through its own end and preserves timing through canonical replacement', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const metadata = new ClaudeMessageMetadata()
  const projection = new ThreadMessageProjection(
    { backendId: runtimeId('claude'), id: runtimeId('root') },
    metadata.decorate
  )
  onTestFinished(() => projection.close())
  const startedAt = Date.now()
  const accept = async (parts: RuntimeMessage['parts'], complete = false) => {
    const batch: ClaudeObservation = {
      events: [
        {
          type: 'message.upsert',
          message: {
            id: complete ? 'canonical' : 'partial',
            role: 'assistant',
            parts,
            metadata: { completeness: complete ? 'complete' : 'partial' }
          },
          ...(complete ? { replaces: [{ session: projection.thread, id: runtimeId<'item'>('partial') }] } : {})
        }
      ],
      native: [
        {
          source: 'live',
          message: {
            type: 'stream_event',
            event: { type: 'message_stop' },
            parent_tool_use_id: null,
            uuid: randomUUID(),
            session_id: 'session'
          }
        }
      ],
      retracted: []
    }
    await projection.accept(batch.events, metadata.accept(batch) ? true : [])
  }
  await accept([{ type: 'reasoning', text: 'First', state: 'streaming' }])
  vi.advanceTimersByTime(100)
  const first = { type: 'reasoning' as const, text: 'First', state: 'done' as const }
  await accept([first, { type: 'text', text: 'Answer', state: 'streaming' }])
  expect(projection.snapshot().messages[0].parts[0]).toMatchObject({
    providerMetadata: { cherry: { thinkingMs: 100 } }
  })
  vi.advanceTimersByTime(10_000)
  const answer = { type: 'text' as const, text: 'Answer', state: 'done' as const }
  await accept([first, answer, { type: 'reasoning', text: 'Second', state: 'streaming' }])
  vi.advanceTimersByTime(250)
  const second = { type: 'reasoning' as const, text: 'Second', state: 'done' as const }
  await accept([first, answer, second])
  vi.advanceTimersByTime(1_000)
  await accept([first, answer, second], true)
  expect(projection.snapshot().messages[0].parts.filter((part) => part.type === 'reasoning')).toMatchObject([
    { providerMetadata: { cherry: { startedAt, thinkingMs: 100 } } },
    { providerMetadata: { cherry: { startedAt: startedAt + 10_100, thinkingMs: 250 } } }
  ])
})

it('retains SDK signatures, citations and files while applying Cherry reminder filtering', async () => {
  const source: RuntimeMessage = {
    id: 'native',
    role: 'assistant',
    metadata: { completeness: 'complete' },
    parts: [
      {
        type: 'reasoning',
        text: 'Reasoning',
        state: 'done',
        providerMetadata: { anthropic: { signature: 'native-signature' } }
      },
      {
        type: 'reasoning',
        text: '',
        state: 'done',
        providerMetadata: { anthropic: { redactedData: 'encrypted-native-block' } }
      },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA==' },
      {
        type: 'text',
        text: 'Visible<system-reminder>Hidden instructions</system-reminder>',
        state: 'done',
        providerMetadata: {
          anthropic: { citations: [{ type: 'web_search_result_location', url: 'https://example.com' }] }
        }
      }
    ]
  }
  const messages = await project(source)
  expect(messages).toHaveLength(1)
  expect(messages[0].parts.slice(0, 3)).toEqual(source.parts.slice(0, 3))
  expect(messages[0].parts[3]).toEqual({ ...source.parts[3], text: 'Visible' })
  expect(source.parts[3]).toMatchObject({ text: 'Visible<system-reminder>Hidden instructions</system-reminder>' })
})

it('refreshes a late reminder without another native content update', async () => {
  const metadata = new ClaudeMessageMetadata()
  const projection = new ThreadMessageProjection(
    { backendId: runtimeId('claude'), id: runtimeId('root') },
    metadata.decorate
  )
  onTestFinished(() => projection.close())
  const accept = (batch: ClaudeObservation) => projection.accept(batch.events, metadata.accept(batch) ? true : [])
  await accept({
    events: [
      {
        type: 'message.upsert',
        message: {
          id: 'native',
          role: 'assistant',
          metadata: { completeness: 'complete' },
          parts: [
            { type: 'text', text: 'Visible hidden reminder', state: 'done' },
            {
              type: 'dynamic-tool',
              toolName: 'Bash',
              toolCallId: 'call',
              input: { command: 'pwd' },
              state: 'input-available'
            }
          ]
        }
      }
    ],
    native: [],
    retracted: []
  })
  const changes = await accept({
    events: [],
    retracted: [],
    native: [
      {
        source: 'live',
        message: {
          type: 'user',
          uuid: randomUUID(),
          session_id: 'session',
          parent_tool_use_id: null,
          isSynthetic: true,
          message: { role: 'user', content: '<system-reminder>hidden reminder</system-reminder>' }
        }
      }
    ]
  })
  expect(changes).toHaveLength(1)
  expect(changes[0].parts).toMatchObject([
    { type: 'text', text: 'Visible ' },
    { type: 'dynamic-tool', toolCallId: 'call', state: 'input-available' }
  ])
})

it('refreshes a replaced MCP catalog and preserves completed reasoning timing', async () => {
  const catalog: Record<string, McpToolDisplayMetadata> = {
    mcp__server__read: { type: 'mcp', serverId: 'server', serverName: 'Before', name: 'read' }
  }
  const metadata = new ClaudeMessageMetadata(catalog)
  const projection = new ThreadMessageProjection(
    { backendId: runtimeId('claude'), id: runtimeId('root') },
    metadata.decorate
  )
  onTestFinished(() => projection.close())
  const source: RuntimeMessage = {
    id: 'native',
    role: 'assistant',
    metadata: { completeness: 'complete' },
    parts: [
      { type: 'reasoning', text: 'Think', state: 'done' },
      {
        type: 'dynamic-tool',
        toolName: 'mcp__server__read',
        toolCallId: 'call',
        input: {},
        state: 'output-available',
        output: 'result'
      }
    ]
  }
  const partial: ClaudeObservation = {
    events: [
      {
        type: 'message.upsert',
        message: {
          ...source,
          metadata: { completeness: 'partial' },
          parts: [{ type: 'reasoning', text: 'Think', state: 'streaming' }]
        }
      }
    ],
    native: [
      {
        source: 'live',
        message: {
          type: 'user',
          uuid: randomUUID(),
          session_id: 'session',
          parent_tool_use_id: null,
          message: { role: 'user', content: 'start' }
        }
      }
    ],
    retracted: []
  }
  await projection.accept(partial.events, metadata.accept(partial) ? true : [])
  const batch: ClaudeObservation = { events: [{ type: 'message.upsert', message: source }], native: [], retracted: [] }
  await projection.accept(batch.events, metadata.accept(batch) ? true : [])
  const reasoning = projection.snapshot().messages[0].parts[0]
  expect(reasoning).toMatchObject({
    type: 'reasoning',
    providerMetadata: { cherry: { startedAt: expect.any(Number), thinkingMs: expect.any(Number) } }
  })
  expect(projection.snapshot().messages[0].parts[1]).toMatchObject({ title: 'Before: read' })
  catalog.mcp__server__read.serverName = 'After'
  const update: ClaudeObservation = { events: [], native: [], retracted: [] }
  const changed = await projection.accept(update.events, metadata.accept(update) ? true : [])
  expect(changed[0].parts[1]).toMatchObject({ title: 'After: read', state: 'output-available' })
  expect(changed[0].parts[0]).toEqual(reasoning)
  expect(await projection.accept(update.events, metadata.accept(update) ? true : [])).toEqual([])
})

it('decorates native tool identity and output without moving surrounding content', async () => {
  const messages = await project({
    id: 'native',
    role: 'assistant',
    metadata: { completeness: 'complete' },
    parts: [
      { type: 'text', text: 'Before', state: 'done' },
      {
        type: 'dynamic-tool',
        toolCallId: 'toolu_native',
        toolName: 'Bash',
        input: { command: 'pwd' },
        state: 'output-available',
        output: [{ type: 'text', text: '/work' }],
        preliminary: true
      },
      { type: 'text', text: 'After', state: 'done' }
    ]
  })
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({
    metadata: { status: 'pending' },
    parts: [
      { type: 'text', text: 'Before' },
      {
        type: 'dynamic-tool',
        toolCallId: 'toolu_native',
        toolName: 'Bash',
        input: { command: 'pwd' },
        state: 'output-available',
        output: '/work',
        preliminary: true,
        providerExecuted: true
      },
      { type: 'text', text: 'After' }
    ]
  })
})
