import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__openai@3.0.53.patch. When `store` is disabled the SDK
// inlines previous assistant turns (with their `itemId`) into the request body
// as `{ role: 'assistant', content: [...], id }`. Volcengine Ark's Doubao models
// reject such items with `MissingParameter: input.status`, so the patch adds
// `status: 'completed'` to keep second-and-later turns working.
describe('patched @ai-sdk/openai Responses assistant input status', () => {
  it('adds status "completed" to inline assistant items when store is disabled', async () => {
    let capturedBody: unknown
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            object: 'response',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            status: 'completed'
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('doubao-seed-2-0-pro')

    await model.doGenerate({
      providerOptions: { openai: { store: false } },
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello', providerOptions: { openai: { itemId: 'msg_0217' } } }]
        },
        { role: 'user', content: [{ type: 'text', text: 'again' }] }
      ]
    })

    const input = (capturedBody as { input: Array<Record<string, unknown>> }).input
    const assistant = input.find((item) => item.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant?.id).toBe('msg_0217')
    expect(assistant?.status).toBe('completed')
  })

  it('keeps using item_reference for stored assistant items by default', async () => {
    let capturedBody: unknown
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            object: 'response',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            status: 'completed'
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('doubao-seed-2-0-pro')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello', providerOptions: { openai: { itemId: 'msg_0217' } } }]
        },
        { role: 'user', content: [{ type: 'text', text: 'again' }] }
      ]
    })

    const input = (capturedBody as { input: Array<Record<string, unknown>> }).input
    expect(input).toContainEqual({ type: 'item_reference', id: 'msg_0217' })
  })
})
