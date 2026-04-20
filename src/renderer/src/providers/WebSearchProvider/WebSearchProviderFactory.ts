import type { WebSearchProvider } from '@renderer/types'

import type BaseWebSearchProvider from './BaseWebSearchProvider'
import BochaProvider from './BochaProvider'
import DefaultProvider from './DefaultProvider'
import ExaMcpProvider from './ExaMcpProvider'
import ExaProvider from './ExaProvider'
import QueritProvider from './QueritProvider'
import SearxngProvider from './SearxngProvider'
import TavilyProvider from './TavilyProvider'
import ZhipuProvider from './ZhipuProvider'

export default class WebSearchProviderFactory {
  static create(provider: WebSearchProvider): BaseWebSearchProvider {
    switch (provider.id) {
      case 'zhipu':
        return new ZhipuProvider(provider)
      case 'tavily':
        return new TavilyProvider(provider)
      case 'bocha':
        return new BochaProvider(provider)
      case 'searxng':
        return new SearxngProvider(provider)
      case 'exa':
        return new ExaProvider(provider)
      case 'exa-mcp':
        return new ExaMcpProvider(provider)
      case 'querit':
        return new QueritProvider(provider)
      default:
        return new DefaultProvider(provider)
    }
  }
}
