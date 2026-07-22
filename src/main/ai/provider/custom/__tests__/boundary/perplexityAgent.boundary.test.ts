import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { PerplexityAgentLanguageModel } from '../../perplexity/PerplexityAgentLanguageModel'
import { captureWithFetch } from './captureRequest'

const config = (fetch: typeof globalThis.fetch) => ({
  baseURL: 'https://api.perplexity.ai',
  headers: () => ({ Authorization: 'Bearer sk-test' }),
  fetch
})

const prompt = (text: string): LanguageModelV3CallOptions['prompt'] => [
  { role: 'user', content: [{ type: 'text', text }] }
]

describe('Perplexity Agent request boundary', () => {
  it('anthropic model: defaults max_output_tokens and web_search, forwards provider options', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('anthropic/claude-opus-4-8', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: {
          perplexity: { maxSteps: 3, reasoningEffort: 'high', webSearch: { searchRecencyFilter: 'week' } }
        }
      })
    )

    expect(req.url).toBe('https://api.perplexity.ai/v1/agent')
    z.strictObject({
      model: z.literal('anthropic/claude-opus-4-8'),
      input: z.array(z.strictObject({ role: z.literal('user'), content: z.literal('Q') })),
      max_output_tokens: z.literal(8192),
      max_steps: z.literal(3),
      reasoning: z.strictObject({ effort: z.literal('high') }),
      tools: z.array(
        z.strictObject({
          type: z.literal('web_search'),
          filters: z.object({ search_recency_filter: z.literal('week') })
        })
      )
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('non-anthropic model with no options: web_search on, no max_output_tokens', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('openai/gpt-5.6-sol', config(fetch)).doGenerate({ prompt: prompt('Q') })
    )

    z.strictObject({
      model: z.literal('openai/gpt-5.6-sol'),
      input: z.array(z.strictObject({ role: z.literal('user'), content: z.literal('Q') })),
      tools: z.array(z.strictObject({ type: z.literal('web_search') }))
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('serializes full web_search config and the fetch_url tool', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: {
          perplexity: {
            webSearch: {
              maxResults: 5,
              searchContextSize: 'high',
              searchDomainFilter: ['-reddit.com'],
              userLocation: { country: 'US' }
            },
            fetchUrl: { maxUrls: 3 }
          }
        }
      })
    )

    z.strictObject({
      model: z.literal('perplexity/sonar'),
      input: z.array(z.strictObject({ role: z.literal('user'), content: z.literal('Q') })),
      tools: z.tuple([
        z.strictObject({
          type: z.literal('web_search'),
          max_results: z.literal(5),
          search_context_size: z.literal('high'),
          filters: z.strictObject({ search_domain_filter: z.array(z.literal('-reddit.com')) }),
          user_location: z.strictObject({ country: z.literal('US') })
        }),
        z.strictObject({ type: z.literal('fetch_url'), max_urls: z.literal(3) })
      ])
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('webSearch:false omits the web_search tool entirely', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        providerOptions: { perplexity: { webSearch: false } }
      })
    )
    expect(req.body).not.toHaveProperty('tools')
  })

  it('routes a URL-referenced PDF to file_url, not file_data', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Summarize' },
              { type: 'file', mediaType: 'application/pdf', data: new URL('https://x.com/doc.pdf') }
            ]
          }
        ]
      })
    )
    const input = (req.body as { input: Array<{ content: Array<{ type: string }> }> }).input
    const fileParts = input[0].content.filter((c) => c.type === 'input_file')
    expect(fileParts).toEqual([{ type: 'input_file', file_url: 'https://x.com/doc.pdf' }])
  })

  it('omits response_format when JSON mode has no schema', async () => {
    const req = await captureWithFetch((fetch) =>
      new PerplexityAgentLanguageModel('perplexity/sonar', config(fetch)).doGenerate({
        prompt: prompt('Q'),
        responseFormat: { type: 'json' }
      })
    )
    expect(req.body).not.toHaveProperty('response_format')
  })
})
