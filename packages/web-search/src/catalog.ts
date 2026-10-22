import type { RemoteProviderId, WebSearchCapability, WebSearchProviderMetadata } from './types'

function capability(
  feature: WebSearchCapability,
  apiKey: 'required' | 'optional' | 'unused',
  defaultApiHost?: string
): WebSearchProviderMetadata['capabilities'][number] {
  return Object.freeze({ capability: feature, apiKey, requiresApiHost: true, defaultApiHost })
}

function provider(
  id: RemoteProviderId,
  name: string,
  capabilities: WebSearchProviderMetadata['capabilities']
): WebSearchProviderMetadata {
  return Object.freeze({ id, name, type: id === 'exa-mcp' ? 'mcp' : 'api', capabilities: Object.freeze(capabilities) })
}

export const WEB_SEARCH_PROVIDER_CATALOG: Readonly<Record<RemoteProviderId, WebSearchProviderMetadata>> = Object.freeze(
  {
    zhipu: provider('zhipu', 'Zhipu', [
      capability('searchKeywords', 'required', 'https://open.bigmodel.cn/api/paas/v4/web_search')
    ]),
    tavily: provider('tavily', 'Tavily', [capability('searchKeywords', 'required', 'https://api.tavily.com')]),
    searxng: provider('searxng', 'Searxng', [capability('searchKeywords', 'unused')]),
    exa: provider('exa', 'Exa', [capability('searchKeywords', 'required', 'https://api.exa.ai')]),
    'exa-mcp': provider('exa-mcp', 'ExaMCP', [
      capability('searchKeywords', 'optional', 'https://mcp.exa.ai/mcp'),
      capability('fetchUrls', 'optional', 'https://mcp.exa.ai/mcp')
    ]),
    yuanbao: provider('yuanbao', 'Yuanbao', [
      capability('searchKeywords', 'required', 'https://api.wsa.cloud.tencent.com')
    ]),
    bocha: provider('bocha', 'Bocha', [capability('searchKeywords', 'required', 'https://api.bochaai.com')]),
    querit: provider('querit', 'Querit', [
      capability('searchKeywords', 'required', 'https://api.querit.ai'),
      capability('fetchUrls', 'required', 'https://api.querit.ai')
    ]),
    jina: provider('jina', 'Jina', [
      capability('searchKeywords', 'required', 'https://s.jina.ai'),
      capability('fetchUrls', 'optional', 'https://r.jina.ai')
    ]),
    firecrawl: provider('firecrawl', 'Firecrawl', [
      capability('searchKeywords', 'optional', 'https://api.firecrawl.dev'),
      capability('fetchUrls', 'optional', 'https://api.firecrawl.dev')
    ]),
    crawl4ai: provider('crawl4ai', 'Crawl4AI', [capability('fetchUrls', 'optional', 'https://api.crawl4ai.com')]),
    parallel: provider('parallel', 'Parallel', [capability('searchKeywords', 'required', 'https://api.parallel.ai')]),
    serply: provider('serply', 'Serply', [capability('searchKeywords', 'required', 'https://api.serply.io')]),
    deepseek: provider('deepseek', 'DeepSeek', [
      capability('searchKeywords', 'required', 'https://api.deepseek.com'),
      capability('fetchUrls', 'required', 'https://api.deepseek.com')
    ])
  }
)
