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

  it('splits cutoff tokens across multiple results', async () => {
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [
          {
            title: 'First',
            content: 'one two three',
            url: 'https://allowed.example/one',
            sourceInput: 'hello'
          },
          {
            title: 'Second',
            content: 'four five six',
            url: 'https://allowed.example/two',
            sourceInput: 'hello'
          }
        ]
      },
      runtimeConfig
    )

    expect(result.response.results.map((item) => item.content)).toEqual(['one two...', 'four five...'])
  })

  it('keeps at least one token per result when cutoff is smaller than result count', async () => {
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [
          {
            title: 'First',
            content: 'one two',
            url: 'https://allowed.example/one',
            sourceInput: 'hello'
          },
          {
            title: 'Second',
            content: 'three four',
            url: 'https://allowed.example/two',
            sourceInput: 'hello'
          }
        ]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'cutoff',
          cutoffLimit: 1
        }
      }
    )

    expect(result.response.results.map((item) => item.content)).toEqual(['one...', 'three...'])
  })

  it('keeps results unchanged when compression is disabled', async () => {
    const result = await postProcessWebSearchResponse(response, {
      ...runtimeConfig,
      compression: {
        method: 'none',
        cutoffLimit: 5
      }
    })

    expect(result.response.results[0].content).toBe('one two three four five six seven')
  })
})
