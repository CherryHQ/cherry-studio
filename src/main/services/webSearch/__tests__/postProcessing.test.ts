import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { countTokens as countCl100kTokens } from 'gpt-tokenizer/encoding/cl100k_base'
import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base'
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
  it('applies the shared cutoff without adding unbudgeted marker tokens', async () => {
    const result = await postProcessWebSearchResponse(response, runtimeConfig)

    expect(result.response.results[0]).toMatchObject({
      content: 'one two three four five',
      budget: {
        status: 'truncated',
        reason: 'configured_cutoff',
        originalTokens: 7,
        retainedTokens: 5,
        originalBytes: 33,
        retainedBytes: 23
      }
    })
    expect(result.response.budget).toMatchObject({
      reason: 'configured_cutoff',
      tokenLimit: 5,
      originalTokens: 7,
      retainedTokens: 5
    })
  })

  it('distributes the shared cutoff remainder without wasting budget', async () => {
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

    expect(result.response.results.map((item) => item.content)).toEqual(['one two three', 'four five'])
    expect(result.response.results.map((item) => item.budget?.status)).toEqual(['retained', 'truncated'])
    expect(result.response.budget?.retainedTokens).toBe(5)
  })

  it('omits later content when the cutoff is smaller than the result count', async () => {
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

    expect(result.response.results.map((item) => item.content)).toEqual(['one', ''])
    expect(result.response.results.map((item) => item.budget)).toEqual([
      {
        status: 'truncated',
        reason: 'configured_cutoff',
        originalTokens: 2,
        retainedTokens: 1,
        originalBytes: 7,
        retainedBytes: 3
      },
      {
        status: 'omitted',
        reason: 'configured_cutoff',
        originalTokens: 2,
        retainedTokens: 0,
        originalBytes: 10,
        retainedBytes: 0
      }
    ])
    expect(result.response.budget?.retainedTokens).toBe(1)
  })

  it('keeps safe content unchanged when compression is disabled', async () => {
    const result = await postProcessWebSearchResponse(response, {
      ...runtimeConfig,
      compression: {
        method: 'none',
        cutoffLimit: 10
      }
    })

    expect(result.response).toBe(response)
  })

  it('enforces the token hard limit when compression is disabled', async () => {
    const result = await postProcessWebSearchResponse(response, {
      ...runtimeConfig,
      compression: {
        method: 'none',
        cutoffLimit: 5
      }
    })

    expect(result.response.results[0]).toMatchObject({
      content: 'one two three four five',
      budget: {
        status: 'truncated',
        reason: 'hard_limit',
        retainedTokens: 5
      }
    })
    expect(result.response.budget).toMatchObject({
      reason: 'hard_limit',
      tokenLimit: 5,
      retainedTokens: 5
    })
  })

  it('uses the reference tokenizer to bound low-delimiter content that the heuristic undercounts', async () => {
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content: '1'.repeat(1_000) }]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 2
        }
      }
    )

    expect(countO200kTokens(result.response.results[0].content)).toBeLessThanOrEqual(2)
    expect(result.response.results[0].budget).toMatchObject({
      status: 'truncated',
      reason: 'hard_limit',
      originalTokens: countO200kTokens('1'.repeat(1_000)),
      retainedTokens: expect.any(Number),
      originalBytes: 1_000,
      retainedBytes: expect.any(Number)
    })
    expect(result.response.budget).toMatchObject({
      byteLimit: 16,
      originalBytes: 1_000,
      retainedBytes: expect.any(Number)
    })
    expect(result.response.budget?.retainedTokens).toBeLessThanOrEqual(2)
  })

  it('counts all tokens in content larger than the aggregate byte ceiling', async () => {
    const content = '1'.repeat(500_000)
    const originalTokens = Math.max(countO200kTokens(content), countCl100kTokens(content))
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content }]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 2
        }
      }
    )

    expect(result.response.results[0].budget?.originalTokens).toBe(originalTokens)
    expect(result.response.budget?.originalTokens).toBe(originalTokens)
  })

  it('counts aggregate original tokens before applying per-result byte allocations', async () => {
    const contents = ['1'.repeat(300_000), '2'.repeat(300_000)]
    const originalTokens = contents.reduce(
      (total, content) => total + Math.max(countO200kTokens(content), countCl100kTokens(content)),
      0
    )
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: contents.map((content, index) => ({
          ...response.results[0],
          title: `Result ${index}`,
          content
        }))
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 50_000
        }
      }
    )

    expect(result.response.results.map((item) => item.budget?.originalTokens)).toEqual(
      contents.map((content) => Math.max(countO200kTokens(content), countCl100kTokens(content)))
    )
    expect(result.response.budget?.originalTokens).toBe(originalTokens)
  })

  it('uses the stricter reference encoding when cl100k exceeds o200k', async () => {
    const content = '🧑‍💻'
    expect(countO200kTokens(content)).toBe(6)
    expect(countCl100kTokens(content)).toBe(7)

    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content }]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 6
        }
      }
    )

    expect(result.response.results[0].content).not.toBe(content)
    expect(content.startsWith(result.response.results[0].content)).toBe(true)
    expect(countCl100kTokens(result.response.results[0].content)).toBeLessThanOrEqual(6)
    expect(result.response.results[0].budget).toMatchObject({ status: 'truncated', reason: 'hard_limit' })
  })

  it('omits unsplittable astral results without cross-result decoder state', async () => {
    const content = '𐀀'
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: Array.from({ length: 4 }, (_, index) => ({
          ...response.results[0],
          title: `Result ${index}`,
          content
        }))
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'cutoff',
          cutoffLimit: 4
        }
      }
    )

    expect(result.response.results.map((item) => item.content)).toEqual(['', '', '', ''])
    expect(result.response.results.every((item) => item.budget?.status === 'omitted')).toBe(true)
    expect(result.response.budget?.retainedTokens).toBe(0)
    expect(result.response.budget?.retainedTokens).toBeLessThanOrEqual(4)
  })

  it('treats tokenizer control text as ordinary untrusted page content', async () => {
    const specialTokenContent = '<|endoftext|>'
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content: specialTokenContent }]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 10
        }
      }
    )

    expect(result.response.results[0].content).toBe(specialTokenContent)
  })

  it('enforces the aggregate UTF-8 ceiling without splitting a surrogate pair', async () => {
    const oversizedUnicodeContent = `${' '.repeat(13)}😀`
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content: oversizedUnicodeContent }]
      },
      {
        ...runtimeConfig,
        compression: {
          method: 'none',
          cutoffLimit: 2
        }
      }
    )

    const retained = result.response.results[0].content
    expect(Buffer.byteLength(retained, 'utf8')).toBeLessThanOrEqual(16)
    expect(retained.endsWith('\ud83d')).toBe(false)
    expect(result.response.results[0].budget).toMatchObject({ status: 'truncated', reason: 'hard_limit' })
    expect(result.response.budget).toMatchObject({ byteLimit: 16, retainedBytes: 13 })
  })

  it('does not return a trailing unpaired low surrogate', async () => {
    const result = await postProcessWebSearchResponse(
      {
        ...response,
        results: [{ ...response.results[0], content: `safe\udc00` }]
      },
      runtimeConfig
    )

    expect(result.response.results[0].content.endsWith('\udc00')).toBe(false)
  })
})
