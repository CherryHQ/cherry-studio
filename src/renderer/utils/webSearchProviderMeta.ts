import { type IconRef, providerIconRef } from '@cherrystudio/ui/icons'
import type {
  WebSearchCapability,
  WebSearchProvider,
  WebSearchProviderId
} from '@shared/data/preference/preferenceTypes'

export type WebSearchProviderCapability = WebSearchProvider['capabilities'][number]

export type WebSearchProviderMenuEntry = {
  key: string
  capability: WebSearchCapability
  provider: WebSearchProvider
  providerCapability: WebSearchProviderCapability
}

export type WebSearchProviderFeatureSection = {
  capability: WebSearchCapability
  entries: WebSearchProviderMenuEntry[]
}

const WEB_SEARCH_CAPABILITY_ORDER: readonly WebSearchCapability[] = ['searchKeywords', 'fetchUrls'] as const

type WebSearchProviderDisplayMeta = {
  descriptionKey: string
  iconRef: IconRef
  officialWebsite?: string
  apiKeyWebsite?: string
}

const WEB_SEARCH_PROVIDER_DISPLAY_META: Record<WebSearchProviderId, WebSearchProviderDisplayMeta> = {
  bocha: {
    descriptionKey: 'settings.tool.websearch.provider_description.bocha',
    iconRef: providerIconRef('bocha'),
    officialWebsite: 'https://bochaai.com',
    apiKeyWebsite: 'https://open.bochaai.com/overview'
  },
  exa: {
    descriptionKey: 'settings.tool.websearch.provider_description.exa',
    iconRef: providerIconRef('exa'),
    officialWebsite: 'https://exa.ai',
    apiKeyWebsite: 'https://dashboard.exa.ai/api-keys'
  },
  'exa-mcp': {
    descriptionKey: 'settings.tool.websearch.provider_description.exa_mcp',
    iconRef: providerIconRef('exa'),
    officialWebsite: 'https://exa.ai'
  },
  fetch: {
    descriptionKey: 'settings.tool.websearch.provider_description.fetch',
    iconRef: providerIconRef('cherryin')
  },
  jina: {
    descriptionKey: 'settings.tool.websearch.provider_description.jina',
    iconRef: providerIconRef('jina'),
    officialWebsite: 'https://jina.ai/reader',
    apiKeyWebsite: 'https://jina.ai'
  },
  parallel: {
    descriptionKey: 'settings.tool.websearch.provider_description.parallel',
    iconRef: providerIconRef('parallel'),
    officialWebsite: 'https://parallel.ai',
    apiKeyWebsite: 'https://platform.parallel.ai'
  },
  querit: {
    descriptionKey: 'settings.tool.websearch.provider_description.querit',
    iconRef: providerIconRef('querit'),
    officialWebsite: 'https://querit.ai',
    apiKeyWebsite: 'https://www.querit.ai/en/dashboard/api-keys'
  },
  searxng: {
    descriptionKey: 'settings.tool.websearch.provider_description.searxng',
    iconRef: providerIconRef('searxng'),
    officialWebsite: 'https://docs.searxng.org'
  },
  tavily: {
    descriptionKey: 'settings.tool.websearch.provider_description.tavily',
    iconRef: providerIconRef('tavily'),
    officialWebsite: 'https://tavily.com',
    apiKeyWebsite: 'https://app.tavily.com/home'
  },
  zhipu: {
    descriptionKey: 'settings.tool.websearch.provider_description.zhipu',
    iconRef: providerIconRef('zhipu'),
    officialWebsite: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
    apiKeyWebsite: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
  },
  firecrawl: {
    descriptionKey: 'settings.tool.websearch.provider_description.firecrawl',
    iconRef: providerIconRef('firecrawl'),
    officialWebsite: 'https://firecrawl.dev',
    apiKeyWebsite: 'https://firecrawl.dev/app/api-keys'
  }
}

export function getWebSearchProviderDescriptionKey(providerId: WebSearchProviderId): string {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].descriptionKey
}

export function getWebSearchProviderIconRef(providerId: WebSearchProviderId): IconRef {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].iconRef
}

export function getWebSearchProviderOfficialWebsite(providerId: WebSearchProviderId): string | undefined {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].officialWebsite
}

export function getWebSearchProviderApiKeyWebsite(providerId: WebSearchProviderId): string | undefined {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].apiKeyWebsite
}

export function getWebSearchCapabilityTitleKey(capability: WebSearchCapability): string {
  return capability === 'fetchUrls'
    ? 'settings.tool.websearch.fetch_urls_provider'
    : 'settings.tool.websearch.search_provider'
}

export function createWebSearchMenuEntry(
  provider: WebSearchProvider,
  capability: WebSearchCapability
): WebSearchProviderMenuEntry | null {
  const providerCapability = provider.capabilities.find((item) => item.feature === capability)

  if (!providerCapability) {
    return null
  }

  return {
    key: `${capability}:${provider.id}`,
    capability,
    provider,
    providerCapability
  }
}

export function getWebSearchFeatureSections(
  providers: readonly WebSearchProvider[]
): WebSearchProviderFeatureSection[] {
  return WEB_SEARCH_CAPABILITY_ORDER.map((capability) => {
    const entries = providers
      .map((provider) => createWebSearchMenuEntry(provider, capability))
      .filter((entry): entry is WebSearchProviderMenuEntry => Boolean(entry))

    return { capability, entries }
  }).filter((section) => section.entries.length > 0)
}
