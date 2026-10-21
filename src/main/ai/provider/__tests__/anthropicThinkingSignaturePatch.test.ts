import { createRequire } from 'node:module'

import { createAnthropic } from '@ai-sdk/anthropic'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__anthropic.patch. The upstream non-streaming response schema
// requires `signature` on a thinking block, but anthropic-messages gateways (CherryIN's
// `agent/*` models) return thinking blocks without one — a valid HTTP 200 that, unpatched,
// fails schema validation (AI_TypeValidationError → "Invalid JSON response") and breaks
// every non-streaming call, e.g. topic naming. The patch makes `signature` optional. If an
// SDK upgrade drops the patch, this test fails loudly.
describe('patched @ai-sdk/anthropic response schema tolerates a signature-less thinking block', () => {
  it('parses a 200 whose thinking block omits signature', async () => {
    const body = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'agent/deepseek-v4-pro',
      content: [
        { type: 'thinking', thinking: 'weighing the title' },
        { type: 'text', text: 'Trip planning' }
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 4 }
    }
    const model = createAnthropic({
      apiKey: 'test',
      fetch: async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })('agent/deepseek-v4-pro')

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'name this chat' }] }],
      maxOutputTokens: 64
    })

    expect(result.content).toEqual([
      { type: 'reasoning', text: 'weighing the title', providerMetadata: { anthropic: { signature: undefined } } },
      { type: 'text', text: 'Trip planning' }
    ])
  })
})

const cjsAnthropic = createRequire(import.meta.url)('@ai-sdk/anthropic') as { createAnthropic: typeof createAnthropic }
describe.each([
  ['ESM', createAnthropic],
  ['CJS', cjsAnthropic.createAnthropic]
] as const)('Anthropic alias capabilities (%s)', (_format, createProvider) => {
  it.each([
    ['claude-sonnet-4.6', false, true],
    ['claude-sonnet-4-6', false, true],
    ['claude-sonnet-4.6', true, false],
    ['claude-opus-4.7', false, false],
    ['claude-opus-4-7', false, false],
    ['claude-unknown-99.9', false, false]
  ] as const)(
    'preserves wire ID %s and respects thinking=%s sampling restrictions',
    async (modelId, thinking, keepsTemperature) => {
      let body: Record<string, unknown> = {}
      const sdk = createProvider({
        apiKey: 'test',
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body))
          throw new Error('captured request')
        }
      }).languageModel(modelId)
      await expect(
        sdk.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          temperature: 0.2,
          maxOutputTokens: 2048,
          providerOptions: {
            anthropic: { thinking: thinking ? { type: 'enabled', budgetTokens: 1024 } : { type: 'disabled' } }
          }
        })
      ).rejects.toThrow('captured request')
      expect(body.model).toBe(modelId)
      expect(body.temperature).toBe(keepsTemperature ? 0.2 : undefined)
    }
  )
})
