import { WebSearchProvider } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import DefaultProvider from './DefaultProvider'
import ExaProvider from './ExaProvider'
import SearxngProvider from './SearxngProvider'
import TavilyProvider from './TavilyProvider'

export default class WebSearchProviderFactory {
  static create(provider: WebSearchProvider): BaseWebSearchProvider {
    switch (provider.id) {
      case 'tavily':
        return new TavilyProvider(provider)
      case 'searxng':
        return new SearxngProvider(provider)
      case 'exa':
        return new ExaProvider(provider)

      default:
        return new DefaultProvider(provider)
    }
  }
}
