import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { countTokens as countCl100kTokens } from 'gpt-tokenizer/encoding/cl100k_base'
import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base'
import { afterEach, describe, expect, it, vi } from 'vitest'

const response: WebSearchResponse = {
  query: 'hello',
  providerId: 'tavily',
  capability: 'searchKeywords',
  inputs: ['hello'],
  results: [
    {
      title: 'Allowed',
      content: '1'.repeat(1_000),
      url: 'https://allowed.example/post',
      sourceInput: 'hello'
    }
  ]
}

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 5,
  excludeDomains: [],
  compression: {
    method: 'none',
    cutoffLimit: 2
  }
}

describe('postProcessWebSearchResponse tokenizer fallback', () => {
  afterEach(() => {
    vi.doUnmock('gpt-tokenizer/encoding/o200k_base')
    vi.doUnmock('gpt-tokenizer/encoding/cl100k_base')
    vi.resetModules()
  })

  it('falls back when the reference tokenizer cannot load and retries it later', async () => {
    vi.resetModules()
    vi.doMock('gpt-tokenizer/encoding/o200k_base', () => {
      throw new Error('tokenizer load failed')
    })
    vi.doMock('gpt-tokenizer/encoding/cl100k_base', () => {
      throw new Error('tokenizer load failed')
    })
    const { postProcessWebSearchResponse } = await import('../postProcessing')

    const fallbackResult = await postProcessWebSearchResponse(response, runtimeConfig)

    vi.doUnmock('gpt-tokenizer/encoding/o200k_base')
    vi.doUnmock('gpt-tokenizer/encoding/cl100k_base')
    const recoveredResult = await postProcessWebSearchResponse(response, runtimeConfig)

    expect(fallbackResult.response.results[0].content.length).toBeLessThan(response.results[0].content.length)
    expect(fallbackResult.response.results[0].budget).toMatchObject({
      status: 'truncated',
      reason: 'hard_limit',
      retainedTokens: 2,
      retainedBytes: 2
    })
    expect(countO200kTokens(fallbackResult.response.results[0].content)).toBeLessThanOrEqual(2)
    expect(countCl100kTokens(fallbackResult.response.results[0].content)).toBeLessThanOrEqual(2)
    expect(recoveredResult.response.results[0].content.length).toBeGreaterThanOrEqual(
      fallbackResult.response.results[0].content.length
    )
  })
})
