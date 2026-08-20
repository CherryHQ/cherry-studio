import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * Guards the message-item hunk in patches/@ai-sdk__openai@3.0.53.patch.
 * Volcengine Ark rejects message input items that omit `type` or `status`
 * (400 MissingParameter: input.status / input.type, #18253) — the adapter infers
 * both from role. Sending them unconditionally is the canonical Responses shape
 * OpenAI accepts, so no provider needs a separate adapter for it.
 */
describe('patched @ai-sdk/openai assistant input items', () => {
  it('sends explicit type and status on message items', async () => {
    let body: any
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'm',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('doubao-seed-2-1-pro-260628')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Say A' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
        { role: 'user', content: [{ type: 'text', text: 'Now say B' }] }
      ],
      providerOptions: { openai: { store: false } }
    })

    expect(body.input.filter((item: any) => item.role === 'assistant')).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'A' }],
        id: undefined,
        status: 'completed'
      }
    ])
    expect(body.input.filter((item: any) => item.role === 'user').every((item: any) => item.type === 'message')).toBe(
      true
    )
  })
})
