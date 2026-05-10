import type { WebSearchCapability, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import { findWebSearchCapability } from '@shared/data/presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import type { TFunction } from 'i18next'

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

const WEB_SEARCH_PROVIDER_AVATAR_COLORS = {
  bocha: '#0f766e',
  exa: '#111827',
  'exa-mcp': '#111827',
  fetch: '#16a34a',
  jina: '#7c3aed',
  querit: '#2563eb',
  searxng: '#0ea5e9',
  tavily: '#6366f1',
  zhipu: '#7c3aed'
} as const satisfies Record<WebSearchProviderId, string>

const WEB_SEARCH_PROVIDER_DESCRIPTION_KEYS = {
  bocha: 'settings.tool.websearch.provider_description.bocha',
  exa: 'settings.tool.websearch.provider_description.exa',
  'exa-mcp': 'settings.tool.websearch.provider_description.exa_mcp',
  fetch: 'settings.tool.websearch.provider_description.fetch',
  jina: 'settings.tool.websearch.provider_description.jina',
  querit: 'settings.tool.websearch.provider_description.querit',
  searxng: 'settings.tool.websearch.provider_description.searxng',
  tavily: 'settings.tool.websearch.provider_description.tavily',
  zhipu: 'settings.tool.websearch.provider_description.zhipu'
} as const satisfies Record<WebSearchProviderId, string>

export function getWebSearchProviderAvatarColor(providerId: WebSearchProviderId): string {
  return WEB_SEARCH_PROVIDER_AVATAR_COLORS[providerId]
}

export function getWebSearchProviderDescriptionKey(providerId: WebSearchProviderId): string {
  return WEB_SEARCH_PROVIDER_DESCRIPTION_KEYS[providerId]
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

export function getUnavailableProviderDialogConfig(
  provider: ResolvedWebSearchProvider,
  t: TFunction,
  missingReason: 'apiKey' | 'apiHost'
) {
  const missingFieldLabel =
    missingReason === 'apiKey' ? t('settings.tool.websearch.apikey') : t('settings.provider.api_host')

  return {
    title: t('settings.tool.websearch.search_provider'),
    content: `${provider.name} ${missingFieldLabel}`,
    okText: t('settings.tool.websearch.api_key_required.ok')
  }
}
