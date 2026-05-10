import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { postProcessWebSearchResponse } from '../postProcessing'

const response: WebSearchResponse = {
  query: 'hello',
  providerId: 'tavily',
  capability: 'searchKeywords',
  inputs: ['hello'],
  results: [
    {
      title: 'Allowed',
      content: 'one two three four five six seven',
      url: 'https://allowed.example/post',
      sourceInput: 'hello'
    }
  ]
}

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 5,
  excludeDomains: [],
  compression: {
    method: 'cutoff',
    cutoffLimit: 5
  }
}

describe('postProcessWebSearchResponse', () => {
  it('applies cutoff by token count', async () => {
    const result = await postProcessWebSearchResponse(response, runtimeConfig)

    expect(result.response.results[0].content).toBe('one two three four five...')
  })
})
