import type { WebSearchProviderMetadata } from './types'
const definitions = {
  zhipu: {
    name: 'Zhipu',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
      }
    ]
  },
  tavily: {
    name: 'Tavily',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.tavily.com'
      }
    ]
  },
  searxng: {
    name: 'Searxng',
    type: 'api',
    capabilities: [{ capability: 'searchKeywords', requiresApiHost: true, requiresApiKey: false }]
  },
  exa: {
    name: 'Exa',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.exa.ai'
      }
    ]
  },
  'exa-mcp': {
    name: 'ExaMCP',
    type: 'mcp',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: false,
        defaultApiHost: 'https://mcp.exa.ai/mcp'
      }
    ]
  },
  bocha: {
    name: 'Bocha',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.bochaai.com'
      }
    ]
  },
  querit: {
    name: 'Querit',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.querit.ai'
      },
      { capability: 'fetchUrls', requiresApiHost: true, requiresApiKey: true, defaultApiHost: 'https://api.querit.ai' }
    ]
  },
  jina: {
    name: 'Jina',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://s.jina.ai'
      },
      { capability: 'fetchUrls', requiresApiHost: true, requiresApiKey: false, defaultApiHost: 'https://r.jina.ai' }
    ]
  },
  firecrawl: {
    name: 'Firecrawl',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: false,
        defaultApiHost: 'https://api.firecrawl.dev'
      },
      {
        capability: 'fetchUrls',
        requiresApiHost: true,
        requiresApiKey: false,
        defaultApiHost: 'https://api.firecrawl.dev'
      }
    ]
  },
  crawl4ai: {
    name: 'Crawl4AI',
    type: 'api',
    capabilities: [{ capability: 'fetchUrls', requiresApiHost: true, requiresApiKey: false }]
  },
  parallel: {
    name: 'Parallel',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.parallel.ai'
      }
    ]
  },
  serply: {
    name: 'Serply',
    type: 'api',
    capabilities: [
      {
        capability: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        defaultApiHost: 'https://api.serply.io'
      }
    ]
  }
}
export const webSearchCatalog: readonly WebSearchProviderMetadata[] = Object.freeze(
  Object.entries(definitions).map(([id, value]) =>
    Object.freeze({
      id,
      ...value,
      capabilities: Object.freeze(value.capabilities.map((capability) => Object.freeze(capability)))
    })
  )
) as readonly WebSearchProviderMetadata[]
