export type WebSearchProviderType = 'api' | 'local' | 'mcp'

export interface WebSearchProviderPreset {
  id: string
  name: string
  type: WebSearchProviderType
  usingBrowser: boolean
  defaultApiHost: string
}

export type WebSearchProviderOverride = Partial<{
  apiKey: string
  apiHost: string
  engines: string[]
  basicAuthUsername: string
  basicAuthPassword: string
}>

export type WebSearchProviderOverrides = Record<string, WebSearchProviderOverride>

export const PRESETS_WEB_SEARCH_PROVIDERS: WebSearchProviderPreset[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.tavily.com'
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: ''
  },
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.exa.ai'
  },
  {
    id: 'exa-mcp',
    name: 'ExaMCP',
    type: 'mcp',
    usingBrowser: false,
    defaultApiHost: 'https://mcp.exa.ai/mcp'
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.bochaai.com'
  },
  {
    id: 'local-google',
    name: 'Google',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'local-bing',
    name: 'Bing',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
  },
  {
    id: 'local-baidu',
    name: 'Baidu',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.baidu.com/s?wd=%s'
  }
]
