import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * Guards the sampling-parameter hunk in patches/@ai-sdk__openai@3.0.53.patch.
 * `forceReasoning` exists to make the adapter emit `reasoning` for models its
 * own id allowlist does not recognize — Cherry sets it for every Responses
 * request. Upstream also let it drive "OpenAI reasoning models reject
 * temperature/top_p", which silently dropped the user's sampling settings on
 * qwen / doubao / deepseek the moment an explicit effort tier was picked.
 * That restriction is a fact about OpenAI's own models, so it stays keyed on
 * the model id.
 */
async function capture(modelId: string) {
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
  }).responses(modelId)

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    temperature: 0.7,
    topP: 0.9,
    providerOptions: { openai: { reasoningEffort: 'low', forceReasoning: true, store: false } }
  })

  return body
}

describe('patched @ai-sdk/openai sampling parameters', () => {
  it.each(['qwen3-max', 'doubao-seed-2-1-pro-260628'])('keeps temperature and top_p for %s', async (modelId) => {
    const body = await capture(modelId)

    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.temperature).toBe(0.7)
    expect(body.top_p).toBe(0.9)
  })

  it("still strips them for OpenAI's own reasoning models", async () => {
    const body = await capture('gpt-5')

    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
  })
})
