import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'
import { createOpenAICompatibleRerankingModel } from '../openai-compatible-reranking-model'

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

    let error: unknown
    try {
      await model.doRerank({
        query: 'hello',
        documents: { type: 'text', values: ['alpha'] }
      })
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) {
      throw new Error('Expected rerank to reject with an Error')
    }
    expect(error.cause).toBeInstanceOf(Error)
    if (!(error.cause instanceof Error)) {
      throw new Error('Expected rerank error cause to be an Error')
    }
    expect(error.cause.message).toBe('Rerank response results must contain numeric index and relevance_score')
  })

  it.each([-1, 1.5, 99])('rejects invalid rerank response index %s', async (index) => {
    const model = createOpenAICompatibleRerankingModel('rerank-model', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1',
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ index, relevance_score: 0.7 }]
          })
        )
      )
    })

    let error: unknown
    try {
      await model.doRerank({
        query: 'hello',
        documents: { type: 'text', values: ['alpha', 'beta'] }
      })
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) {
      throw new Error('Expected rerank to reject with an Error')
    }
    expect(error.cause).toBeInstanceOf(Error)
    if (!(error.cause instanceof Error)) {
      throw new Error('Expected rerank error cause to be an Error')
    }
    expect(error.cause.message).toBe('Rerank response results must reference a valid document index')
  })

  it('rejects non-2xx responses', async () => {
    const model = createOpenAICompatibleRerankingModel('rerank-model', {
      name: 'openai-compatible',
      baseURL: 'https://api.example.com/v1',
      fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }))
    })

    await expect(
      model.doRerank({
        query: 'hello',
        documents: { type: 'text', values: ['alpha'] }
      })
    ).rejects.toThrow()
  })

  it('is reused by CherryIN reranking models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ index: 0, relevance_score: 0.7 }]
        })
      )
    )
    const provider = createCherryIn({
      apiKey: 'cherry-key',
      baseURL: 'https://open.cherryin.net/v1',
      headers: { 'x-static': 'yes' },
      fetch: fetchMock
    })

    const result = await provider.rerankingModel('BAAI/bge-reranker-v2-m3').doRerank({
      query: 'hello',
      documents: { type: 'text', values: ['alpha'] },
      topN: 1
    })

    expect(fetchMock).toHaveBeenCalledWith('https://open.cherryin.net/v1/rerank', expect.any(Object))
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'BAAI/bge-reranker-v2-m3',
      query: 'hello',
      documents: ['alpha'],
      top_n: 1
    })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer cherry-key')
    expect(new Headers(init.headers).get('x-static')).toBe('yes')
    expect(result.ranking).toEqual([{ index: 0, relevanceScore: 0.7 }])
  })
})
