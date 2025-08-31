import { WebSearchProvider } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'
import BochaProvider from './BochaProvider'
import DefaultProvider from './DefaultProvider'
import ExaProvider from './ExaProvider'
import LocalBaiduProvider from './LocalBaiduProvider'
import LocalBingProvider from './LocalBingProvider'
import LocalGoogleProvider from './LocalGoogleProvider'
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
      case 'local-google':
        return new LocalGoogleProvider(provider)
      case 'local-baidu':
        return new LocalBaiduProvider(provider)
      case 'local-bing':
        return new LocalBingProvider(provider)
      default:
        return new DefaultProvider(provider)
    }
  }
}
