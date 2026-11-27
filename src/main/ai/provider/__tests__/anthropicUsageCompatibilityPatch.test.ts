import { createRequire } from 'node:module'

import { createAnthropic } from '@ai-sdk/anthropic'
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cjs: { createAnthropic: typeof createAnthropic } = require('@ai-sdk/anthropic')
const cjsInternal: {
  AnthropicMessagesLanguageModel: typeof AnthropicMessagesLanguageModel
} = require('@ai-sdk/anthropic/internal')
const factories = [
  { name: 'ESM', create: (fetch) => createAnthropic({ apiKey: 'test', fetch })('compatible-model') },
  { name: 'CJS', create: (fetch) => cjs.createAnthropic({ apiKey: 'test', fetch })('compatible-model') },
  {
    name: 'internal ESM',
    create: (fetch) =>
      new AnthropicMessagesLanguageModel('compatible-model', {
        provider: 'anthropic.messages',
        baseURL: 'https://provider.invalid/v1',
        headers: {},
        fetch
      })
  },
  {
    name: 'internal CJS',
    create: (fetch) =>
      new cjsInternal.AnthropicMessagesLanguageModel('compatible-model', {
        provider: 'anthropic.messages',
        baseURL: 'https://provider.invalid/v1',
        headers: {},
        fetch
      })
  }
] satisfies { name: string; create: (fetch: typeof globalThis.fetch) => LanguageModelV3 }[]

function response(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

function frames(initialUsage: unknown, finalUsage: unknown) {
  return [
    {
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'compatible-model', usage: initialUsage }
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'BODY_OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: finalUsage },
    { type: 'message_stop' }
  ]
}

const prompt = [{ role: 'user', content: [{ type: 'text', text: 'Reply briefly' }] }] satisfies Parameters<
  LanguageModelV3['doStream']
>[0]['prompt']

describe.each(factories)('Anthropic usage compatibility: $name', ({ create }) => {
  async function read(initialUsage: unknown, finalUsage: unknown) {
    const model = create(async () => response(frames(initialUsage, finalUsage)))
    const { stream } = await model.doStream({ prompt })
    const parts: LanguageModelV3StreamPart[] = await Array.fromAsync(stream)
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(
      parts
        .filter((part) => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('')
    ).toBe('BODY_OK')
    const finish = parts.find((part) => part.type === 'finish')
    expect(finish?.finishReason.unified).toBe('stop')
    return finish?.usage
  }

  it('accepts an empty initial usage and uses the later cumulative counts', async () => {
    const usage = await read({}, { input_tokens: 9, output_tokens: 2, cache_read_input_tokens: 4 })
    expect(usage?.inputTokens).toEqual({ total: 13, noCache: 9, cacheRead: 4, cacheWrite: 0 })
    expect(usage?.outputTokens.total).toBe(2)
  })

  it('keeps missing input usage unknown while still delivering the response', async () => {
    const usage = await read({}, { output_tokens: 2, cache_read_input_tokens: 4 })
    expect(usage?.inputTokens).toEqual({ total: undefined, noCache: undefined, cacheRead: 4, cacheWrite: 0 })
    expect(usage?.raw).toEqual({ output_tokens: 2, cache_read_input_tokens: 4 })
    expect(usage?.outputTokens.total).toBe(2)
  })

  it('preserves initial counts when the final chunk only reports output tokens', async () => {
    const usage = await read(
      { input_tokens: 12, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 },
      { output_tokens: 2 }
    )
    expect(usage?.inputTokens).toEqual({ total: 20, noCache: 12, cacheRead: 5, cacheWrite: 3 })
  })

  it('preserves an explicitly reported zero', async () => {
    const usage = await read({ input_tokens: 0 }, { output_tokens: 2 })
    expect(usage?.inputTokens.total).toBe(0)
    expect(usage?.inputTokens.noCache).toBe(0)
  })

  it.each([undefined, null, {}])('delivers a stream without usage: %j', async (usage) => {
    const result = await read(usage, usage)
    expect(result?.inputTokens.total).toBeUndefined()
    expect(result?.inputTokens.noCache).toBeUndefined()
    expect(result?.outputTokens.total).toBeUndefined()
    expect(result?.outputTokens.text).toBeUndefined()
  })

  it('does not erase known cumulative counts when a later delta omits usage', async () => {
    const sequence = frames({}, { input_tokens: 9, output_tokens: 2 })
    sequence.splice(-1, 0, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: undefined
    })
    const model = create(async () => response(sequence))
    const { stream } = await model.doStream({ prompt })
    const parts = await Array.fromAsync(stream)
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    const finish = parts.find((part) => part.type === 'finish')
    expect(finish?.usage.inputTokens.total).toBe(9)
    expect(finish?.usage.outputTokens.total).toBe(2)
  })

  it('preserves executor iteration and cache totals', async () => {
    const usage = await read(
      {},
      {
        input_tokens: 9,
        output_tokens: 2,
        cache_read_input_tokens: 4,
        iterations: [
          { type: 'compaction', input_tokens: 10, output_tokens: 3 },
          { type: 'message', input_tokens: 9, output_tokens: 2 },
          { type: 'advisor_message', input_tokens: 100, output_tokens: 50 }
        ]
      }
    )
    expect(usage?.inputTokens.total).toBe(23)
    expect(usage?.outputTokens.total).toBe(5)
  })

  it('keeps incomplete iteration totals unknown instead of undercounting', async () => {
    const usage = await read(
      {},
      {
        input_tokens: 9,
        output_tokens: 2,
        iterations: [
          { type: 'compaction', input_tokens: 10, output_tokens: 3 },
          { type: 'message', output_tokens: 2 }
        ]
      }
    )
    expect(usage?.inputTokens.total).toBeUndefined()
    expect(usage?.outputTokens.total).toBe(5)
  })

  it.each([undefined, null, {}, { input_tokens: null, output_tokens: null }])(
    'delivers non-streaming content without usage: %j',
    async (usage) => {
      const model = create(
        async () =>
          new Response(
            JSON.stringify({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'BODY_OK' }],
              stop_reason: 'end_turn',
              usage
            }),
            { headers: { 'content-type': 'application/json' } }
          )
      )
      const result = await model.doGenerate({ prompt })
      expect(result.content).toEqual([{ type: 'text', text: 'BODY_OK' }])
      expect(result.finishReason.unified).toBe('stop')
      expect(result.usage.inputTokens.total).toBeUndefined()
      expect(result.usage.outputTokens.total).toBeUndefined()
    }
  )

  it('preserves available non-streaming counts and extension metadata', async () => {
    const model = create(
      async () =>
        new Response(
          JSON.stringify({
            type: 'message',
            content: [{ type: 'text', text: 'BODY_OK' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 12,
              cache_read_input_tokens: 5,
              output_tokens_details: { thinking_tokens: 3 },
              vendor_total: 99
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    )
    const result = await model.doGenerate({ prompt })
    expect(result.usage.inputTokens.total).toBe(17)
    expect(result.usage.outputTokens).toEqual({ total: undefined, text: undefined, reasoning: 3 })
    expect(result.usage.raw?.vendor_total).toBe(99)
  })

  it('rejects malformed input usage as validation failure without inventing HTTP 500', async () => {
    const model = create(async () => response(frames({ input_tokens: '9' }, { input_tokens: 9, output_tokens: 2 })))
    const error = await Promise.resolve(model.doStream({ prompt })).catch((error: unknown) => error)
    expect(error).toMatchObject({
      name: 'AI_TypeValidationError',
      value: { message: { usage: { input_tokens: '9' } } }
    })
    expect(error).not.toHaveProperty('statusCode')
  })

  it('still rejects missing tool-call identity', async () => {
    const model = create(
      async () =>
        new Response(
          JSON.stringify({
            type: 'message',
            content: [{ type: 'tool_use', name: 'Read', input: { path: '/tmp/example' } }],
            stop_reason: 'tool_use',
            usage: {}
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    )
    await expect(model.doGenerate({ prompt })).rejects.toMatchObject({ cause: { name: 'AI_TypeValidationError' } })
  })

  it('still reports a native overloaded SSE error as retryable HTTP 529', async () => {
    const model = create(async () =>
      response([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }])
    )
    await expect(model.doStream({ prompt })).rejects.toMatchObject({
      name: 'AI_APICallError',
      statusCode: 529,
      isRetryable: true
    })
  })
})
