import { createXai } from '@ai-sdk/xai'
import { describe, expect, it } from 'vitest'

describe('patched @ai-sdk/xai reasoning options', () => {
  it('serializes Grok 4.6 xhigh reasoning effort', async () => {
    let requestBody: Record<string, unknown> = {}
    const model = createXai({
      apiKey: 'test',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ error: { message: 'captured' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
    }).responses('grok-4.6')

    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        maxOutputTokens: 64,
        providerOptions: { xai: { reasoningEffort: 'xhigh' } }
      })
    ).rejects.toBeDefined()

    expect(requestBody.reasoning).toEqual({ effort: 'xhigh' })
  })
})
