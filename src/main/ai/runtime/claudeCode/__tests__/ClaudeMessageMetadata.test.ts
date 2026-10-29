import { expect, it } from 'vitest'

import { runtimeId, type RuntimeMessage } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'

import { ClaudeMessageMetadata } from '../ClaudeMessageMetadata'

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
