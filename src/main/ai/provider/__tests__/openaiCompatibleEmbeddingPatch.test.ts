import { OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__openai-compatible@2.0.37.patch. The upstream embedding
// response schema requires `usage.prompt_tokens`, but Jina's /v1/embeddings returns
// `usage: { total_tokens }` with no prompt_tokens — a valid HTTP 200 that, unpatched,
// fails schema validation (AI_TypeValidationError → "Invalid JSON response") and breaks
// every Jina embedding request. The patch makes `prompt_tokens` optional, accepts
// `total_tokens`, and falls back to it for the token count. If an SDK upgrade drops the
// patch, this test fails loudly.
describe('patched @ai-sdk/openai-compatible embedding schema tolerates Jina usage shape', () => {
  it('parses a 200 whose usage omits prompt_tokens, using total_tokens for the token count', async () => {
    const jinaBody = {
      model: 'jina-embeddings-v3',
      object: 'list',
      usage: { total_tokens: 3 },
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }]
    }
    const model = new OpenAICompatibleEmbeddingModel('jina-embeddings-v3', {
      provider: 'jina',
      url: () => 'https://api.jina.ai/v1/embeddings',
      headers: () => ({}),
      fetch: async () =>
        new Response(JSON.stringify(jinaBody), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const result = await model.doEmbed({ values: ['test'] })

    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]])
    expect(result.usage).toEqual({ tokens: 3 })
  })
})
