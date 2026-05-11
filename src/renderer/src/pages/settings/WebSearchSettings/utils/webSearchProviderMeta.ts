import type { CompoundIcon } from '@cherrystudio/ui'
import { Bocha, Cherryin, Exa, Jina, Querit, Searxng, Tavily, Zhipu } from '@cherrystudio/ui/icons'
import type { WebSearchCapability, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import { findWebSearchCapability } from '@shared/data/presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

export type ResolvedWebSearchProviderCapability = ResolvedWebSearchProvider['capabilities'][number]

export type WebSearchProviderMenuEntry = {
  key: string
  capability: WebSearchCapability
  provider: ResolvedWebSearchProvider
  providerCapability: ResolvedWebSearchProviderCapability
}

export type WebSearchProviderFeatureSection = {
  capability: WebSearchCapability
  entries: WebSearchProviderMenuEntry[]
}

const WEB_SEARCH_CAPABILITY_ORDER: readonly WebSearchCapability[] = ['searchKeywords', 'fetchUrls'] as const

type WebSearchProviderDisplayMeta = {
  avatarColor: string
  descriptionKey: string
  logo: CompoundIcon
  officialWebsite?: string
  apiKeyWebsite?: string
}

const WEB_SEARCH_PROVIDER_DISPLAY_META: Record<WebSearchProviderId, WebSearchProviderDisplayMeta> = {
  bocha: {
    avatarColor: '#0f766e',
    descriptionKey: 'settings.tool.websearch.provider_description.bocha',
    logo: Bocha,
    officialWebsite: 'https://bochaai.com',
    apiKeyWebsite: 'https://open.bochaai.com/overview'
  },
  exa: {
    avatarColor: '#111827',
    descriptionKey: 'settings.tool.websearch.provider_description.exa',
    logo: Exa,
    officialWebsite: 'https://exa.ai',
    apiKeyWebsite: 'https://dashboard.exa.ai/api-keys'
  },
  'exa-mcp': {
    avatarColor: '#111827',
    descriptionKey: 'settings.tool.websearch.provider_description.exa_mcp',
    logo: Exa,
    officialWebsite: 'https://exa.ai'
  },
  fetch: {
    avatarColor: '#16a34a',
    descriptionKey: 'settings.tool.websearch.provider_description.fetch',
    logo: Cherryin
  },
  jina: {
    avatarColor: '#7c3aed',
    descriptionKey: 'settings.tool.websearch.provider_description.jina',
    logo: Jina,
    officialWebsite: 'https://jina.ai/reader',
    apiKeyWebsite: 'https://jina.ai'
  },
  querit: {
    avatarColor: '#2563eb',
    descriptionKey: 'settings.tool.websearch.provider_description.querit',
    logo: Querit,
    officialWebsite: 'https://querit.ai',
    apiKeyWebsite: 'https://www.querit.ai/en/dashboard/api-keys'
  },
  searxng: {
    avatarColor: '#0ea5e9',
    descriptionKey: 'settings.tool.websearch.provider_description.searxng',
    logo: Searxng,
    officialWebsite: 'https://docs.searxng.org'
  },
  tavily: {
    avatarColor: '#6366f1',
    descriptionKey: 'settings.tool.websearch.provider_description.tavily',
    logo: Tavily,
    officialWebsite: 'https://tavily.com',
    apiKeyWebsite: 'https://app.tavily.com/home'
  },
  zhipu: {
    avatarColor: '#7c3aed',
    descriptionKey: 'settings.tool.websearch.provider_description.zhipu',
    logo: Zhipu,
    officialWebsite: 'https://docs.bigmodel.cn/cn/guide/tools/web-search',
    apiKeyWebsite: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
  }
}

export function getWebSearchProviderAvatarColor(providerId: WebSearchProviderId): string {
  return WEB_SEARCH_PROVIDER_DISPLAY_META[providerId].avatarColor
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
  provider: ResolvedWebSearchProvider,
  capability: WebSearchCapability
): WebSearchProviderMenuEntry | null {
  const providerCapability = findWebSearchCapability(provider, capability)

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
  providers: readonly ResolvedWebSearchProvider[]
): WebSearchProviderFeatureSection[] {
  return WEB_SEARCH_CAPABILITY_ORDER.map((capability) => {
    const entries = providers
      .map((provider) => createWebSearchMenuEntry(provider, capability))
      .filter((entry): entry is WebSearchProviderMenuEntry => Boolean(entry))

    return { capability, entries }
  }).filter((section) => section.entries.length > 0)
}

export function flattenWebSearchFeatureSections(
  featureSections: readonly WebSearchProviderFeatureSection[]
): WebSearchProviderMenuEntry[] {
  return featureSections.flatMap((section) => section.entries)
}

export function resolveWebSearchEntryCapability(
  provider: ResolvedWebSearchProvider,
  requestedCapability?: string
): WebSearchCapability {
  if (
    requestedCapability === 'fetchUrls' &&
    provider.capabilities.some((capability) => capability.feature === requestedCapability)
  ) {
    return requestedCapability
  }

  if (
    requestedCapability === 'searchKeywords' &&
    provider.capabilities.some((capability) => capability.feature === requestedCapability)
  ) {
    return requestedCapability
  }

  return provider.capabilities[0]?.feature ?? 'searchKeywords'
}
