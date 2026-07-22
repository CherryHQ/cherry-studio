import { describe, expect, it } from 'vitest'

import { createPerplexityProvider } from '../custom/perplexity/perplexityProvider'
import { PerplexityExtension } from '../extensions'

describe('PerplexityExtension toolFactories', () => {
  const provider = createPerplexityProvider({ apiKey: 'sk-test' })

  it('wires webSearch to the provider web-search tool', () => {
    const factory = PerplexityExtension.config.toolFactories?.webSearch
    expect(factory).toBeDefined()
    expect(factory(provider)({ maxResults: 5 })).toMatchObject({
      tools: {
        webSearch: { type: 'provider', id: 'perplexity.web_search', args: { maxResults: 5 } }
      }
    })
  })

  it('wires urlContext to the provider fetch-url tool', () => {
    const factory = PerplexityExtension.config.toolFactories?.urlContext
    expect(factory).toBeDefined()
    expect(factory(provider)({ maxUrls: 3 })).toMatchObject({
      tools: {
        urlContext: { type: 'provider', id: 'perplexity.fetch_url', args: { maxUrls: 3 } }
      }
    })
  })
})
