import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { createCustomParamsFetch } from '../customParamsFetch'

// A synthetic protocol oracle proves first-hop bytes, not DMXAPI relay acceptance.
const captures: Array<{ bytes: string; status: number }> = []
const server = createServer(async (request, response) => {
  let bytes = ''
  for await (const chunk of request) bytes += chunk.toString()
  const body = JSON.parse(bytes)
  const invalid = body.thinking?.type === 'adaptive' && Object.hasOwn(body.thinking, 'budget_tokens')
  const status = invalid ? 400 : 200
  captures.push({ bytes, status })
  if (invalid) {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Synthetic oracle: adaptive.budget_tokens is forbidden' }
      })
    )
    return
  }
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 }
  }
  if (body.stream) {
    response.writeHead(status, { 'content-type': 'text/event-stream' })
    const events = [
      { type: 'message_start', message },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' }
    ]
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  } else {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        ...message,
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 }
      })
    )
  }
})
let baseURL: string
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

const prompts: LanguageModelV3CallOptions['prompt'][] = [
  [{ role: 'user', content: [{ type: 'text', text: 'probe' }] }],
  [
    { role: 'user', content: [{ type: 'text', text: 'probe' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'lookup-1', toolName: 'lookup', input: { query: 'probe' } }]
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'lookup-1',
          toolName: 'lookup',
          output: { type: 'json', value: { found: true } }
        }
      ]
    }
  ]
]

function makeModel(modelId: string, fetch: typeof globalThis.fetch) {
  return new AnthropicMessagesLanguageModel(modelId, {
    provider: 'dmxapi.anthropic',
    baseURL,
    headers: () => ({ 'x-api-key': 'dummy-key' }),
    fetch,
    supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] }),
    supportsNativeStructuredOutput: false
  })
}

async function invoke(model: AnthropicMessagesLanguageModel, streaming: boolean, options: LanguageModelV3CallOptions) {
  if (!streaming) {
    const result = await model.doGenerate(options)
    expect(result.content).toContainEqual({ type: 'text', text: 'ok' })
    return
  }
  const { stream } = await model.doStream(options)
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  expect(parts.filter((part) => part.type === 'error')).toEqual([])
  expect(parts).toContainEqual({ type: 'text-delta', id: '0', delta: 'ok' })
}

describe.each(['claude-opus-4-6', 'claude-opus-4-6-cc'])('%s real Anthropic serialization', (modelId) => {
  describe.each([false, true])('streaming=%s', (streaming) => {
    it('rejects the raw fallback before HTTP on the first and later tool-step request', async () => {
      let original: unknown
      const wrapped = createCustomParamsFetch(
        globalThis.fetch,
        { thinking: { type: 'adaptive', budget_tokens: 2048 } },
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      )
      const model = makeModel(modelId, async (input, init) => {
        try {
          return await wrapped(input, init)
        } catch (error) {
          original = error
          throw error
        }
      })
      for (const prompt of prompts) {
        const before = captures.length
        const error = await invoke(model, streaming, { prompt, maxOutputTokens: 8192 }).catch(
          (failure: unknown) => failure
        )
        expect.soft(captures.slice(before)).toEqual([])
        expect.soft(error).toBe(original)
        expect.soft(error).toMatchObject({
          name: 'InvalidAdaptiveThinkingBudgetError',
          message:
            'Adaptive thinking does not accept budget_tokens. Remove thinking.budget_tokens, or use enabled thinking if the model supports it.'
        })
      }
    })

    it.each<{
      label: string
      custom: Record<string, unknown>
      providerOptions: LanguageModelV3CallOptions['providerOptions']
    }>([
      {
        label: 'adaptive display and binding',
        custom: {
          thinking: { type: 'adaptive', display: 'summarized', block_binding: { enabled: true } },
          unrelated_key: 'keep-me'
        },
        providerOptions: {}
      },
      { label: 'enabled budget', custom: { thinking: { type: 'enabled', budget_tokens: 2048 } }, providerOptions: {} },
      {
        label: 'SDK replaces raw conflict',
        custom: { thinking: { type: 'adaptive', budget_tokens: 2048 }, unrelated_key: 'keep-me' },
        providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } }
      }
    ])('preserves legacy wrapper bytes: $label on both requests', async ({ custom, providerOptions }) => {
      // This is the pre-guard wrapper's exact shallow-merge/re-serialization contract.
      const legacy: typeof globalThis.fetch = (input, init) =>
        globalThis.fetch(input, { ...init, body: JSON.stringify({ ...custom, ...JSON.parse(String(init?.body)) }) })
      const guarded = makeModel(
        modelId,
        createCustomParamsFetch(globalThis.fetch, custom, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      )
      const baseline = makeModel(modelId, legacy)
      for (const prompt of prompts) {
        const options = { prompt, maxOutputTokens: 8192, providerOptions }
        const before = captures.length
        await invoke(baseline, streaming, options)
        await invoke(guarded, streaming, options)
        const [old, current] = captures.slice(before)
        expect(current).toEqual(old)
        expect(current.status).toBe(200)
      }
    })
  })
})
