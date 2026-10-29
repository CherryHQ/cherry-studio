import { randomUUID } from 'node:crypto'

import { expect, it, onTestFinished } from 'vitest'

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

it('refreshes a denied tool and a late reminder without another native content update', async () => {
  const metadata = new ClaudeMessageMetadata()
  const projection = new ThreadMessageProjection(
    { backendId: runtimeId('claude'), id: runtimeId('root') },
    metadata.decorate
  )
  onTestFinished(() => projection.close())
  const accept = (batch: ClaudeObservation) => projection.accept(batch.events, metadata.accept(batch))
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
          type: 'system',
          subtype: 'permission_denied',
          tool_use_id: 'call',
          tool_name: 'Bash',
          message: 'Permission denied',
          uuid: randomUUID(),
          session_id: 'session'
        }
      },
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
    { type: 'dynamic-tool', toolCallId: 'call', state: 'output-denied', approval: { approved: false } }
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
  await projection.accept(partial.events, metadata.accept(partial))
  const batch: ClaudeObservation = { events: [{ type: 'message.upsert', message: source }], native: [], retracted: [] }
  await projection.accept(batch.events, metadata.accept(batch))
  const reasoning = projection.snapshot().messages[0].parts[0]
  expect(reasoning).toMatchObject({
    type: 'reasoning',
    providerMetadata: { cherry: { startedAt: expect.any(Number), thinkingMs: expect.any(Number) } }
  })
  expect(projection.snapshot().messages[0].parts[1]).toMatchObject({ title: 'Before: read' })
  catalog.mcp__server__read.serverName = 'After'
  const update: ClaudeObservation = { events: [], native: [], retracted: [] }
  const changed = await projection.accept(update.events, metadata.accept(update))
  expect(changed[0].parts[1]).toMatchObject({ title: 'After: read', state: 'output-available' })
  expect(changed[0].parts[0]).toEqual(reasoning)
  expect(await projection.accept(update.events, metadata.accept(update))).toEqual([])
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
