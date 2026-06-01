import { describe, expect, it, vi } from 'vitest'

import { createOpenAICompatibleRerankingModel } from '../rerankingModel'

describe('createOpenAICompatibleRerankingModel', () => {
  it('posts OpenAI-compatible rerank requests and parses relevance_score', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'jina-reranker',
          object: 'list',
          usage: { total_tokens: 1 },
          results: [
            { index: 1, relevance_score: 0.9, document: 'beta' },
            { index: 0, relevance_score: 0, document: 'alpha' }
          ]
        })
      )
    )

    const model = createOpenAICompatibleRerankingModel('jina-reranker', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1/',
      apiKey: 'secret',
      headers: { 'x-static': 'yes' },
      queryParams: { route: 'jina' },
      fetch: fetchMock
    })

    const result = await model.doRerank({
      query: 'hello',
      documents: { type: 'text', values: ['alpha', 'beta'] },
      topN: 2,
      headers: { 'x-call': 'yes' }
    })

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/rerank?route=jina', expect.any(Object))
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(
      JSON.stringify({
        model: 'jina-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        top_n: 2
      })
    )
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret')
    expect(new Headers(init.headers).get('x-static')).toBe('yes')
    expect(new Headers(init.headers).get('x-call')).toBe('yes')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(result.ranking).toEqual([
      { index: 1, relevanceScore: 0.9 },
      { index: 0, relevanceScore: 0 }
    ])
    expect(result.response?.body).toEqual({
      model: 'jina-reranker',
      object: 'list',
      usage: { total_tokens: 1 },
      results: [
        { index: 1, relevance_score: 0.9, document: 'beta' },
        { index: 0, relevance_score: 0, document: 'alpha' }
      ]
    })
  })

  it('rejects non-text documents', async () => {
    const model = createOpenAICompatibleRerankingModel('rerank-model', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1'
    })

    await expect(
      model.doRerank({
        query: 'hello',
        documents: { type: 'object', values: [{ text: 'alpha' }] }
      })
    ).rejects.toThrow('only supports text documents')
  })

  it('rejects malformed successful responses', async () => {
    const model = createOpenAICompatibleRerankingModel('rerank-model', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1',
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ index: 0 }]
          })
        )
      )
    })

    await expect(
      model.doRerank({
        query: 'hello',
        documents: { type: 'text', values: ['alpha'] }
      })
    ).rejects.toThrow('Failed to process successful response')
  })
})
