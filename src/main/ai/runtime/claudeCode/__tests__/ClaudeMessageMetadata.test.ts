import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages'
import { expect, it } from 'vitest'

import { runtimeId, type ContentItem, type ItemRef, type Thread } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'

import { ClaudeMessageMetadata } from '../ClaudeMessageMetadata'
import { ClaudeCodeStreamAdapter } from '../streamAdapter'

const thread: Thread = { backendId: runtimeId('claude'), id: runtimeId('root') }
const ref = (id: string): ItemRef => ({ session: thread, id: runtimeId(id) })
async function project(content: BetaContentBlockParam[], items: ContentItem[]) {
  const metadata = new ClaudeMessageMetadata(
    new ClaudeCodeStreamAdapter({
      modelId: 'claude',
      sessionId: 'product',
      streamOptions: { prompt: [] },
      sink: { enqueue() {} },
      statusSink: { emit() {} }
    })
  )
  const projection = new ThreadMessageProjection(thread, metadata.decorate)
  const batch: ClaudeObservation = {
    events: items.map((item) => ({ type: 'item.upsert', item })),
    retracted: [],
    native: [
      {
        source: 'archive',
        message: {
          type: 'assistant',
          uuid: 'native',
          session_id: 'root',
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: { content }
        }
      }
    ]
  }
  metadata.accept(batch)
  for (const event of batch.events) await projection.accept(event)
  const messages = projection.snapshot().messages
  await projection.close()
  return messages
}

// Common text normalization must not strip the native signature required for a subsequent tool round.
it('preserves thinking signatures and redacted thinking on archive projection', async () => {
  const messages = await project(
    [
      { type: 'thinking', thinking: 'Reasoning', signature: 'native-signature' },
      { type: 'redacted_thinking', data: 'encrypted-native-block' }
    ],
    [
      {
        type: 'message',
        ref: ref('native:0'),
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Reasoning' }],
        completeness: 'complete'
      },
      { type: 'message', ref: ref('native:1'), role: 'assistant', parts: [], completeness: 'complete' }
    ]
  )
  expect(messages.flatMap((message) => message.parts)).toEqual([
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
    }
  ])
})

// A common item with no text still needs a visible native image/document; it is not an empty message.
it('retains image and document bodies while filtering native reminders from visible text', async () => {
  const messages = await project(
    [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } },
      { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Document content' } },
      { type: 'text', text: 'Visible<system-reminder>Hidden instructions</system-reminder>' }
    ],
    [0, 1, 2].map((index) => ({
      type: 'message',
      ref: ref(`native:${index}`),
      role: 'assistant',
      parts:
        index === 2 ? [{ type: 'text', text: 'Visible<system-reminder>Hidden instructions</system-reminder>' }] : [],
      completeness: 'complete'
    }))
  )
  expect(messages.flatMap((message) => message.parts)).toEqual([
    { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA==' },
    {
      type: 'file',
      mediaType: 'text/plain',
      url: `data:text/plain;base64,${Buffer.from('Document content').toString('base64')}`
    },
    { type: 'text', text: 'Visible', state: 'done' }
  ])
})

// Tool controls address the real native call ID, not the projection source UUID and block index.
it('keeps native tool IDs and structured output in the shared message model', async () => {
  const messages = await project(
    [
      { type: 'tool_use', id: 'toolu_native', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', tool_use_id: 'toolu_native', content: [{ type: 'text', text: '/work' }] }
    ],
    [
      {
        type: 'tool-call',
        ref: ref('native:0'),
        name: 'Bash',
        argumentsText: '{"command":"pwd"}',
        completeness: 'complete'
      },
      {
        type: 'tool-result',
        ref: ref('native:1'),
        call: ref('native:0'),
        parts: [{ type: 'text', text: '/work' }],
        outcome: 'success'
      }
    ]
  )
  expect(messages).toHaveLength(1)
  expect(messages[0].parts).toEqual([
    expect.objectContaining({
      type: 'dynamic-tool',
      toolCallId: 'toolu_native',
      toolName: 'Bash',
      input: { command: 'pwd' },
      state: 'output-available',
      output: '/work',
      providerExecuted: true
    })
  ])
})
