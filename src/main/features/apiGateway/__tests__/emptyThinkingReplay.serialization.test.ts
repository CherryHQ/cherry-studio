import { createAnthropic } from '@ai-sdk/anthropic'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParams, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { generateText, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { toModelMessages } from '@main/ai/messages/messageRules'

import { AnthropicMessageConverter } from '../adapters/converters/AnthropicMessageConverter'
import { AnthropicSseFormatter } from '../adapters/formatters/AnthropicSseFormatter'
import { AiSdkToAnthropicSse } from '../adapters/stream/AiSdkToAnthropicSse'

function history(content: MessageParam['content']): UIMessage[] {
  return new AnthropicMessageConverter().toUIMessages({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content },
      { role: 'user', content: 'Continue' }
    ]
  })
}

async function replay(messages: UIMessage[]) {
  let body: MessageCreateParams | undefined
  const model = createAnthropic({
    apiKey: 'test',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as MessageCreateParams
      const invalid = body.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((block) => block.type === 'thinking' && !block.thinking.trim())
      )
      return new Response(
        JSON.stringify(
          invalid
            ? {
                type: 'error',
                error: {
                  type: 'invalid_request_error',
                  message: 'each thinking block must contain non-whitespace thinking'
                }
              }
            : {
                id: 'msg_next',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-5',
                content: [{ type: 'text', text: 'Recovered' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1, output_tokens: 1 }
              }
        ),
        { status: invalid ? 400 : 200, headers: { 'content-type': 'application/json' } }
      )
    }
  })('claude-sonnet-4-5')
  const result = await generateText({ model, messages: await toModelMessages(messages), maxRetries: 0 })
  expect(result.text).toBe('Recovered')
  return body!.messages.flatMap((message) =>
    message.role === 'assistant' && Array.isArray(message.content) ? message.content : []
  )
}

describe('empty Anthropic thinking history replay', () => {
  it.each([
    { thinking: '', signature: '' },
    { thinking: ' \n\t', signature: '' },
    { thinking: '', signature: 'signed-empty' },
    { thinking: ' \n\t', signature: 'signed-whitespace' }
  ])('recovers incoming history containing $thinking with signature $signature', async (block) => {
    const messages = history([
      { type: 'thinking', ...block },
      { type: 'text', text: 'Previous answer' }
    ])
    const original = structuredClone(messages)
    expect(await replay(messages)).toEqual([{ type: 'text', text: 'Previous answer' }])
    expect(messages).toEqual(original)
  })

  it('recovers an already saved reasoning-only assistant turn', async () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: '', providerMetadata: { anthropic: { signature: '' } } }]
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
    ]
    expect(await replay(messages)).toEqual([])
    expect(messages[1].parts).toHaveLength(1)
  })

  it.each([
    { delta: '', streaming: false },
    { delta: ' \n\t', streaming: false },
    { delta: '', streaming: true },
    { delta: ' \n\t', streaming: true }
  ])('replays gateway reasoning $delta (streaming=$streaming)', async ({ delta, streaming }) => {
    const adapter = new AiSdkToAnthropicSse({ model: 'claude-sonnet-4-5' })
    const events = adapter.transformChunk({ type: 'reasoning-start', id: 'r1' })
    if (delta) events.push(...adapter.transformChunk({ type: 'reasoning-delta', id: 'r1', delta }))
    events.push(...adapter.transformChunk({ type: 'reasoning-end', id: 'r1' }))
    events.push(...adapter.transformChunk({ type: 'text-delta', id: 't1', delta: 'Previous answer' }))
    events.push(...adapter.finalizeEvents())
    const client = new Anthropic({
      apiKey: 'test',
      fetch: async () =>
        new Response(events.map((event) => new AnthropicSseFormatter().formatEvent(event)).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
    })
    const response = streaming
      ? await client.messages.stream({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [] }).finalMessage()
      : adapter.buildNonStreamingResponse()
    expect(response.content[0]).toEqual({ type: 'thinking', thinking: delta, signature: '' })
    expect(await replay(history(response.content))).toEqual([{ type: 'text', text: 'Previous answer' }])
  })

  it('preserves signed non-empty thinking, empty signatures and redacted thinking verbatim', async () => {
    const content: MessageParam['content'] = [
      { type: 'thinking', thinking: '  Keep this thought.\n', signature: 'valid-signature' },
      { type: 'thinking', thinking: 'Gateway thought', signature: '' },
      { type: 'redacted_thinking', data: 'opaque-ciphertext' },
      { type: 'text', text: 'Previous answer' }
    ]
    expect(await replay(history(content))).toEqual(content)
  })
})
