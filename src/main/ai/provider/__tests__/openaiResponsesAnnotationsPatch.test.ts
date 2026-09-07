import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__openai@3.0.53.patch. The upstream non-streaming Responses schema
// requires `annotations` on every output_text part, but third-party Responses implementations
// (Volcano Ark's Agent plan, #19337) omit it entirely — a valid HTTP 200 that, unpatched, fails
// schema validation (AI_TypeValidationError) and breaks every non-streaming call. The patch
// defaults the field to []. If an SDK upgrade drops the patch, this test fails loudly.
describe('patched @ai-sdk/openai responses schema tolerates a missing annotations field', () => {
  it('parses a 200 whose output_text part omits annotations', async () => {
    const body = {
      id: 'resp_1',
      created_at: 1787598519,
      model: 'deepseek-v4-pro',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_1',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello! How can I help you today?' }]
        }
      ],
      usage: { input_tokens: 6, output_tokens: 9, total_tokens: 15 }
    }
    const model = createOpenAI({
      apiKey: 'test',
      fetch: async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }).responses('deepseek-v4-pro')

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })

    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Hello! How can I help you today?',
        providerMetadata: { openai: { itemId: 'msg_1' } }
      }
    ])
  })
})
