import type { WebSearchProvider } from '@renderer/types'

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search',
    apiKey: ''
  },
  {
    id: 'tavily',
    name: 'Tavily',
    apiHost: 'https://api.tavily.com',
    apiKey: ''
  },
  {
    id: 'searxng',
    name: 'Searxng',
    apiHost: '',
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'exa',
    name: 'Exa',
    apiHost: 'https://api.exa.ai',
    apiKey: ''
  },
  {
    id: 'exa-mcp',
    name: 'ExaMCP',
    apiHost: 'https://mcp.exa.ai/mcp'
  },
  {
    id: 'bocha',
    name: 'Bocha',
    apiHost: 'https://api.bochaai.com',
    apiKey: ''
  },
  {
    id: 'querit',
    name: 'Querit',
    apiHost: 'https://api.querit.ai',
    apiKey: ''
  },
  {
    id: 'fetch',
    name: 'fetch'
  },
  {
    id: 'jina',
    name: 'Jina',
    apiHost: 'https://s.jina.ai',
    apiKey: ''
  }
] as const
