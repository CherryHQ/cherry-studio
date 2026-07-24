import { getProviderLabelKey } from '@renderer/i18n/label'
import i18n from '@renderer/i18n/resolver'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import { type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig, Provider } from '@shared/data/types/provider'
import { isCherryAIProvider } from '@shared/utils/provider'

function isCanonicalPresetProvider(provider: Provider): boolean {
  return provider.presetProviderId != null && provider.id === provider.presetProviderId
}

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  // Hide the internal local-embedding provider from the management list: it is
  // download-managed, so editing / disabling / deleting it here would bypass the
  // download card's in-use checks + weight cleanup. Its model still surfaces in
  // capability-filtered model pickers (e.g. the KB embedding picker).
  return !isCherryAIProvider(provider) && provider.id !== LOCAL_EMBEDDING_PROVIDER_ID
}

export function getFancyProviderName(provider: Provider): string {
  if (isCanonicalPresetProvider(provider)) {
    const presetProviderId = provider.presetProviderId
    if (presetProviderId) {
      return i18n.t(getProviderLabelKey(presetProviderId))
    }
  }

  return provider.name
}

export function getProviderSearchString(provider: Provider): string {
  if (isCanonicalPresetProvider(provider)) {
    const presetProviderId = provider.presetProviderId
    if (presetProviderId) {
      return `${i18n.t(getProviderLabelKey(presetProviderId))} ${provider.id}`
    }
  }

  return `${provider.id} ${provider.name}`
}

export function matchKeywordsInProvider(keywords: string[], provider: Provider, extraSearchString?: string): boolean {
  if (keywords.length === 0) return true
  const base = getProviderSearchString(provider)
  const searchStr = (extraSearchString ? `${base} ${extraSearchString}` : base).toLowerCase()
  return keywords.every((kw) => searchStr.includes(kw))
}

/**
 * Replace the domain (host) in all endpointConfigs baseUrls while preserving URL paths
 * and other EndpointConfig fields (modelsApiUrls, adapterFamily).
 * Used by CherryIN/DMXAPI domain switching.
 */
export function replaceEndpointConfigDomain(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  newDomain: string
): Partial<Record<EndpointType, EndpointConfig>> {
  if (!endpointConfigs) return {}
  const result: Partial<Record<EndpointType, EndpointConfig>> = {}
  for (const [key, config] of Object.entries(endpointConfigs)) {
    if (!config) continue
    const ep = key as EndpointType
    const baseUrl = config.baseUrl
    if (!baseUrl) {
      result[ep] = config
      continue
    }
    try {
      const parsed = new URL(baseUrl)
      parsed.hostname = newDomain
      result[ep] = { ...config, baseUrl: parsed.toString().replace(/\/$/, '') }
    } catch {
      result[ep] = config
    }
  }
  return result
}
