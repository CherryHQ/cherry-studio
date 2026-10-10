import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleRerankingModel, OpenAICompatibleRerankingModel } from '../rerankingModel'

describe('createOpenAICompatibleRerankingModel', () => {
  it('re-exports the shared OpenAI-compatible reranking factory', () => {
    const model = createOpenAICompatibleRerankingModel('jina-reranker', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1/'
    })

    expect(model).toBeInstanceOf(OpenAICompatibleRerankingModel)
    expect(model.provider).toBe('openai-compatible.rerank')
  })
})
