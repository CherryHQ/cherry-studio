import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

/**
 * Guards the reasoning-model sampling behavior in the @ai-sdk/openai compatibility patch.
 * `forceReasoning` exists to make the adapter emit `reasoning` for models its
 * own id allowlist does not recognize — Cherry sets it for every Responses
 * request. Upstream also let it drive "OpenAI reasoning models reject
 * temperature/top_p", which silently dropped the user's sampling settings on
 * qwen / doubao / deepseek the moment an explicit effort tier was picked.
 * That restriction is a fact about OpenAI's own models, so it stays keyed on
 * the model id.
 */
async function capture(modelId: string, options: { includeOnly?: boolean; withoutLogprobs?: boolean } = {}) {
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

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    temperature: 0.7,
    topP: 0.9,
    providerOptions: {
      openai: {
        reasoningEffort: 'low',
        forceReasoning: true,
        store: false,
        ...(options.withoutLogprobs
          ? {}
          : options.includeOnly
            ? { include: ['message.output_text.logprobs', 'file_search_call.results'] }
            : { logprobs: 5 })
      }
    }
  })

  return { body, warnings: result.warnings }
}

describe('patched @ai-sdk/openai sampling parameters', () => {
  it.each(['qwen3-max', 'doubao-seed-2-1-pro-260628'])('keeps temperature and top_p for %s', async (modelId) => {
    const { body } = await capture(modelId)

    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.temperature).toBe(0.7)
    expect(body.top_p).toBe(0.9)
  })

  it.each(['gpt-5', 'gpt-6-astra'])("still strips them for OpenAI's own reasoning model %s", async (modelId) => {
    const { body } = await capture(modelId)

    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.logprobs).toBeUndefined()
    if (modelId === 'gpt-6-astra') {
      expect(body.top_logprobs).toBeUndefined()
      expect(body.include).not.toContain('message.output_text.logprobs')
    }
  })

  it('removes an explicitly requested logprobs include for GPT-6 Astra', async () => {
    const { body, warnings } = await capture('gpt-6-astra', { includeOnly: true })

    expect(body.top_logprobs).toBeUndefined()
    expect(body.include).toEqual(expect.arrayContaining(['file_search_call.results', 'reasoning.encrypted_content']))
    expect(body.include).not.toContain('message.output_text.logprobs')
    expect(warnings).toContainEqual({
      type: 'other',
      message: 'topLogprobs is not supported for GPT-6 Astra'
    })
  })

  it('does not warn for GPT-6 Astra when no logprobs fields need removal', async () => {
    const { body, warnings } = await capture('gpt-6-astra', { withoutLogprobs: true })

    expect(body.top_logprobs).toBeUndefined()
    expect(body.include).toEqual(['reasoning.encrypted_content'])
    expect(warnings).not.toContainEqual({
      type: 'other',
      message: 'topLogprobs is not supported for GPT-6 Astra'
    })
  })
})
