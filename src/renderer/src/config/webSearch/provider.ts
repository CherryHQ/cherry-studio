import type {
  WebSearchProvider,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'

type WebSearchProviderConfig = {
  websites: {
    official: string
    apiKey?: string
  }
}

export type RuntimeWebSearchProvider = WebSearchProvider & {
  apiHost: string
  apiKey: string
  basicAuthPassword: string
  basicAuthUsername: string
  engines: string[]
  type: NonNullable<WebSearchProvider['type']>
  usingBrowser: boolean
}

export const WEB_SEARCH_PROVIDER_CONFIG: Record<WebSearchProviderId, WebSearchProviderConfig> = {
  zhipu: {
    websites: {
      official: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
      apiKey: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
    }
  },
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
  },
  'exa-mcp': {
    websites: {
      official: 'https://exa.ai'
    }
  },
  bocha: {
    websites: {
      official: 'https://bochaai.com',
      apiKey: 'https://open.bochaai.com/overview'
    }
  },
  'local-google': {
    websites: {
      official: 'https://www.google.com'
    }
  },
  'local-bing': {
    websites: {
      official: 'https://www.bing.com'
    }
  },
  'local-baidu': {
    websites: {
      official: 'https://www.baidu.com'
    }
  }
}

export const isLocalWebSearchProvider = (provider: Pick<WebSearchProvider, 'type'>) => provider.type === 'local'

export const webSearchProviderRequiresApiKey = (provider: Pick<WebSearchProvider, 'id'>) => {
  switch (provider.id) {
    case 'zhipu':
    case 'tavily':
    case 'exa':
    case 'bocha':
      return true
    default:
      return false
  }
}

export const webSearchProviderSupportsBasicAuth = (provider: Pick<WebSearchProvider, 'id'>) => {
  return provider.id === 'searxng'
}

export const resolveWebSearchProviders = (overrides: WebSearchProviderOverrides = {}): RuntimeWebSearchProvider[] =>
  PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    type: preset.type,
    apiKey: overrides[preset.id]?.apiKey ?? '',
    apiHost: overrides[preset.id]?.apiHost ?? preset.defaultApiHost,
    engines: overrides[preset.id]?.engines ?? [],
    usingBrowser: preset.usingBrowser,
    basicAuthUsername: webSearchProviderSupportsBasicAuth(preset)
      ? (overrides[preset.id]?.basicAuthUsername ?? '')
      : '',
    basicAuthPassword: webSearchProviderSupportsBasicAuth(preset) ? (overrides[preset.id]?.basicAuthPassword ?? '') : ''
  }))

export const buildWebSearchProviderOverrides = (
  providers: Partial<WebSearchProvider>[]
): WebSearchProviderOverrides => {
  const overrides: WebSearchProviderOverrides = {}

  providers.forEach((provider) => {
    const preset = provider.id ? PRESETS_WEB_SEARCH_PROVIDERS.find((item) => item.id === provider.id) : undefined

    if (!preset || !provider.id) {
      return
    }

    const override: NonNullable<WebSearchProviderOverrides[WebSearchProviderId]> = {}
    const apiKey = provider.apiKey?.trim() ?? provider.apiKey
    const apiHost = provider.apiHost?.trim() ?? provider.apiHost
    const basicAuthUsername = provider.basicAuthUsername?.trim() ?? provider.basicAuthUsername
    const basicAuthPassword = provider.basicAuthPassword?.trim() ?? provider.basicAuthPassword

    if (apiKey) {
      override.apiKey = apiKey
    }

    if (apiHost !== undefined && apiHost !== preset.defaultApiHost) {
      override.apiHost = apiHost
    }

    if (provider.engines && provider.engines.length > 0) {
      override.engines = provider.engines
    }

    if (basicAuthUsername) {
      override.basicAuthUsername = basicAuthUsername
    }

    if (basicAuthPassword) {
      override.basicAuthPassword = basicAuthPassword
    }

    if (Object.keys(override).length > 0) {
      overrides[provider.id] = override
    }
  })

  return overrides
}

export const WEB_SEARCH_PROVIDERS: RuntimeWebSearchProvider[] = resolveWebSearchProviders()
