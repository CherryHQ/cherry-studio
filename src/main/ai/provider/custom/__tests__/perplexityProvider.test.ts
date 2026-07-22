import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { PerplexityAgentLanguageModel } from '../perplexity/PerplexityAgentLanguageModel'
import { createPerplexityProvider } from '../perplexity/perplexityProvider'

const callOptions = (text: string): LanguageModelV3CallOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text }] }]
})

const jsonFetch = (body: unknown) =>
  vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    )

describe('createPerplexityProvider', () => {
  it('builds Agent-API language models for every id', () => {
    const provider = createPerplexityProvider({ apiKey: 'sk-test', fetch: vi.fn() })
    expect(provider.languageModel('perplexity/sonar')).toBeInstanceOf(PerplexityAgentLanguageModel)
    expect(provider.languageModel('openai/gpt-5.6-sol').provider).toBe('perplexity')
    expect(provider.tools.webSearch({ maxResults: 5 })).toMatchObject({
      type: 'provider',
      id: 'perplexity.web_search',
      args: { maxResults: 5 }
    })
    expect(provider.tools.fetchUrl({ maxUrls: 3 })).toMatchObject({
      type: 'provider',
      id: 'perplexity.fetch_url',
      args: { maxUrls: 3 }
    })
  })

  it('POSTs /v1/agent and maps output_text + url_citation annotations', async () => {
    const fetch = jsonFetch({
      id: 'r1',
      status: 'completed',
      model: 'openai/gpt-5.6-sol',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Hi',
              annotations: [{ type: 'url_citation', url: 'https://c.com', title: 'C' }]
            }
          ]
        }
      ],
      usage: { input_tokens: 3, output_tokens: 2 }
    })
    const provider = createPerplexityProvider({ apiKey: 'sk-test', fetch })
    const result = await provider.languageModel('openai/gpt-5.6-sol').doGenerate(callOptions('hi'))

    expect(String(fetch.mock.calls[0][0])).toBe('https://api.perplexity.ai/v1/agent')
    expect(result.content).toContainEqual({ type: 'text', text: 'Hi' })
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'source', sourceType: 'url', url: 'https://c.com', title: 'C' })
    )
    expect(result.finishReason.unified).toBe('stop')
    expect(result.usage.inputTokens.total).toBe(3)
  })
})
