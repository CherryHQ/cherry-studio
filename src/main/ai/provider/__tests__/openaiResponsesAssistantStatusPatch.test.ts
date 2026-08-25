import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * Guards the assistant-item hunk in patches/@ai-sdk__openai@3.0.53.patch.
 * Volcengine Ark rejects an assistant input item that omits `type` or `status`
 * (400 MissingParameter, reported one field at a time, #18253) — the adapter
 * infers both from the role. Only the assistant item needs them: Ark validates
 * per item and takes user/system items as-is, so those keep the adapter's
 * string-content shape that stricter implementations may require.
 */
describe('patched @ai-sdk/openai assistant input items', () => {
  it('sends explicit type and status on assistant items only', async () => {
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
    // user/system items keep the adapter's shape — Ark never rejects those.
    expect(body.input.filter((item: any) => item.role === 'user').every((item: any) => item.type === undefined)).toBe(
      true
    )
  })
})
