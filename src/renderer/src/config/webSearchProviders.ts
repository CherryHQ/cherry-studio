import ExaLogo from '@renderer/assets/images/search/exa.png'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
export function getWebSearchProviderLogo(providerId: string) {
  switch (providerId) {
    case 'tavily':
      return TavilyLogo
    case 'searxng':
      return SearxngLogo
    case 'exa':
      return ExaLogo
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
  },
  exa: {
    websites: {
      official: 'https://exa.ai',
      apiKey: 'https://dashboard.exa.ai/api-keys'
    }
  }
}
