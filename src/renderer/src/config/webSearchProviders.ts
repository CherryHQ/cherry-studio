import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import TavilyLogoDark from '@renderer/assets/images/search/tavily-dark.svg'
export function getWebSearchProviderLogo(providerId: string) {
  switch (providerId) {
    case 'tavily':
      return TavilyLogo
    case 'tavily-dark':
      return TavilyLogoDark
    case 'searxng':
      return SearxngLogo

    default:
      return undefined
  }
}

export const WEB_SEARCH_PROVIDER_CONFIG = {
  tavily: {
    websites: {
      official: 'https://tavily.com',
      apiKey: 'https://app.tavily.com/home'
    }
  },
  searxng: {
    websites: {
      official: 'https://docs.searxng.org'
    }
  }
}
