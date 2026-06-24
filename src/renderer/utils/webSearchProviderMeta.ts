import type { CompoundIcon } from '@cherrystudio/ui'
import { Bocha, Cherryin, Exa, Jina, Querit, Searxng, Tavily, Zhipu } from '@cherrystudio/ui/icons'
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
  logo: CompoundIcon
  officialWebsite?: string
  apiKeyWebsite?: string
}

const WEB_SEARCH_PROVIDER_DISPLAY_META: Record<WebSearchProviderId, WebSearchProviderDisplayMeta> = {
  bocha: {
    descriptionKey: 'settings.tool.websearch.provider_description.bocha',
    logo: Bocha,
    officialWebsite: 'https://bochaai.com',
    apiKeyWebsite: 'https://open.bochaai.com/overview'
  },
  exa: {
    descriptionKey: 'settings.tool.websearch.provider_description.exa',
    logo: Exa,
    officialWebsite: 'https://exa.ai',
    apiKeyWebsite: 'https://dashboard.exa.ai/api-keys'
  },
  'exa-mcp': {
    descriptionKey: 'settings.tool.websearch.provider_description.exa_mcp',
    logo: Exa,
    officialWebsite: 'https://exa.ai'
  },
  fetch: {
    descriptionKey: 'settings.tool.websearch.provider_description.fetch',
    logo: Cherryin
  },
  jina: {
    descriptionKey: 'settings.tool.websearch.provider_description.jina',
    logo: Jina,
    officialWebsite: 'https://jina.ai/reader',
    apiKeyWebsite: 'https://jina.ai'
  },
  querit: {
    descriptionKey: 'settings.tool.websearch.provider_description.querit',
    logo: Querit,
    officialWebsite: 'https://querit.ai',
    apiKeyWebsite: 'https://www.querit.ai/en/dashboard/api-keys'
  },
  searxng: {
    descriptionKey: 'settings.tool.websearch.provider_description.searxng',
    logo: Searxng,
    officialWebsite: 'https://docs.searxng.org'
  },
  tavily: {
    descriptionKey: 'settings.tool.websearch.provider_description.tavily',
    logo: Tavily,
    officialWebsite: 'https://tavily.com',
    apiKeyWebsite: 'https://app.tavily.com/home'
  },
  zhipu: {
    descriptionKey: 'settings.tool.websearch.provider_description.zhipu',
    logo: Zhipu,
    officialWebsite: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
    apiKeyWebsite: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
  }
}

export function getWebSearchProviderDescriptionKey(providerId: WebSearchProviderId): string {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].descriptionKey
}

export function getWebSearchProviderLogo(providerId: WebSearchProviderId): CompoundIcon {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].logo
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
    : 'settings.tool.websearch.default_provider'
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
