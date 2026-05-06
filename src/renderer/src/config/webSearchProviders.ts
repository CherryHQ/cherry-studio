import type { CompoundIcon } from '@cherrystudio/ui'
import { Bocha, Cherryin, Exa, Jina, Querit, Searxng, Tavily, Zhipu } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'

const logger = loggerService.withContext('webSearchProviders')

type WebSearchProviderConfig = {
  capabilities: {
    requiresApiKey: boolean
    supportsBasicAuth: boolean
  }
  websites: {
    official: string
    apiKey?: string
  }
}

export const WEB_SEARCH_PROVIDER_CONFIG: Record<WebSearchProviderId, WebSearchProviderConfig> = {
  zhipu: {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
      apiKey: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
    }
  },
  tavily: {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://tavily.com',
      apiKey: 'https://app.tavily.com/home'
    }
  },
  searxng: {
    capabilities: {
      requiresApiKey: false,
      supportsBasicAuth: true
    },
    websites: {
      official: 'https://docs.searxng.org'
    }
  },
  exa: {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://exa.ai',
      apiKey: 'https://dashboard.exa.ai/api-keys'
    }
  },
  'exa-mcp': {
    capabilities: {
      requiresApiKey: false,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://exa.ai'
    }
  },
  bocha: {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://bochaai.com',
      apiKey: 'https://open.bochaai.com/overview'
    }
  },
  querit: {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://querit.ai',
      apiKey: 'https://www.querit.ai/en/dashboard/api-keys'
    }
  },
  fetch: {
    capabilities: {
      requiresApiKey: false,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://github.com/zcaceres/fetch-mcp'
    }
  },
  'jina-reader': {
    capabilities: {
      requiresApiKey: true,
      supportsBasicAuth: false
    },
    websites: {
      official: 'https://jina.ai/reader',
      apiKey: 'https://jina.ai'
    }
  }
}

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
    name: 'Fetch'
  },
  {
    id: 'jina-reader',
    name: 'Jina Reader',
    apiHost: 'https://r.jina.ai',
    apiKey: ''
  }
] as const

export const SUPPORTED_WEB_SEARCH_PROVIDER_IDS = WEB_SEARCH_PROVIDERS.map((provider) => provider.id) as string[]
const warnedUnsupportedProviderIds = new Set<string>()

export function isSupportedWebSearchProviderId(providerId?: string): providerId is WebSearchProviderId {
  if (!providerId) {
    return false
  }

  return SUPPORTED_WEB_SEARCH_PROVIDER_IDS.includes(providerId)
}

export function filterSupportedWebSearchProviders<T extends { id: string }>(providers: T[]): T[] {
  const supportedProviders: T[] = []

  providers.forEach((provider) => {
    if (isSupportedWebSearchProviderId(provider.id)) {
      supportedProviders.push(provider)
      return
    }

    if (!warnedUnsupportedProviderIds.has(provider.id)) {
      warnedUnsupportedProviderIds.add(provider.id)
      logger.warn('Unsupported web-search provider dropped', { providerId: provider.id })
    }
  })

  return supportedProviders
}

export function webSearchProviderRequiresApiKey(providerId: WebSearchProviderId): boolean {
  return WEB_SEARCH_PROVIDER_CONFIG[providerId].capabilities.requiresApiKey
}

export function webSearchProviderSupportsBasicAuth(providerId: WebSearchProviderId): boolean {
  return WEB_SEARCH_PROVIDER_CONFIG[providerId].capabilities.supportsBasicAuth
}

/**
 * Resolve the CompoundIcon for a given web search provider ID.
 * Centralised here so every UI surface uses the same mapping.
 */
export function getWebSearchProviderLogo(providerId: WebSearchProviderId): CompoundIcon | undefined {
  switch (providerId) {
    case 'zhipu':
      return Zhipu
    case 'tavily':
      return Tavily
    case 'searxng':
      return Searxng
    case 'exa':
    case 'exa-mcp':
      return Exa
    case 'bocha':
      return Bocha
    case 'querit':
      return Querit
    case 'fetch':
      return Cherryin
    case 'jina-reader':
      return Jina
    default:
      return undefined
  }
}
