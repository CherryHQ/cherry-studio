import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

import { BochaProvider } from './api/BochaProvider'
import { ExaProvider } from './api/ExaProvider'
import { QueritProvider } from './api/QueritProvider'
import { SearxngProvider } from './api/SearxngProvider'
import { TavilyProvider } from './api/TavilyProvider'
import { ZhipuProvider } from './api/ZhipuProvider'
import type { BaseWebSearchProvider } from './base/BaseWebSearchProvider'
import { LocalBaiduProvider } from './locals/LocalBaiduProvider'
import { LocalBingProvider } from './locals/LocalBingProvider'
import { LocalGoogleProvider } from './locals/LocalGoogleProvider'
import { ExaMcpProvider } from './mcp/ExaMcpProvider'

export function createWebSearchProvider(provider: ResolvedWebSearchProvider): BaseWebSearchProvider {
  switch (provider.id) {
    case 'zhipu':
      return new ZhipuProvider(provider)
    case 'tavily':
      return new TavilyProvider(provider)
    case 'searxng':
      return new SearxngProvider(provider)
    case 'exa':
      return new ExaProvider(provider)
    case 'exa-mcp':
      return new ExaMcpProvider(provider)
    case 'bocha':
      return new BochaProvider(provider)
    case 'querit':
      return new QueritProvider(provider)
    case 'local-google':
      return new LocalGoogleProvider(provider)
    case 'local-bing':
      return new LocalBingProvider(provider)
    case 'local-baidu':
      return new LocalBaiduProvider(provider)
    default:
      throw new Error(`Unsupported web search provider: ${provider.id}`)
  }
}
