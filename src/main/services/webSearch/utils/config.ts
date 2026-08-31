import { providerService } from '@main/data/services/ProviderService'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchCapability,
  WebSearchProvider,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import {
  PRESETS_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_PRESET_MAP,
  type WebSearchProviderPreset
} from '@shared/data/presets/webSearchProviders'
import type { WebSearchExecutionConfig, WebSearchResolvedConfig } from '@shared/data/types/webSearch'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'

import { WebSearchConfigError } from '../WebSearchConfigError'

export interface WebSearchPreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

const DEFAULT_PROVIDER_KEY_BY_CAPABILITY = {
  searchKeywords: 'chat.web_search.default_search_keywords_provider',
  fetchUrls: 'chat.web_search.default_fetch_urls_provider'
} as const satisfies Record<WebSearchCapability, PreferenceKeyType>

function trimString(value: string): string {
  return value.trim()
}

function trimStringList(values: readonly string[]): string[] {
  return values.map(trimString).filter(Boolean)
}

export async function getProviderOverrides(
  preferences: WebSearchPreferenceReader
): Promise<WebSearchProviderOverrides> {
  const providerOverrides = await preferences.get('chat.web_search.provider_overrides')
  return providerOverrides || {}
}

function getWebSearchProviderPresetById(providerId: WebSearchProvider['id']): WebSearchProviderPreset {
  if (!Object.hasOwn(WEB_SEARCH_PROVIDER_PRESET_MAP, providerId)) {
    throw new WebSearchConfigError('provider_unknown', `Unknown web search provider: ${providerId}`)
  }

  return {
    id: providerId,
    ...WEB_SEARCH_PROVIDER_PRESET_MAP[providerId]
  }
}

function mergeWebSearchProviderPreset(
  preset: WebSearchProviderPreset,
  override?: WebSearchProviderOverrides[WebSearchProvider['id']]
): WebSearchProvider {
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    apiKeys: override?.apiKeys ? trimStringList(override.apiKeys) : [],
    capabilities: preset.capabilities.map((capability) => {
      const apiHostOverride = override?.capabilities?.[capability.feature]?.apiHost

      if (capability.apiHost === undefined || apiHostOverride === undefined) {
        return capability
      }

      return {
        ...capability,
        apiHost: trimString(apiHostOverride)
      }
    }),
    engines: override?.engines ? trimStringList(override.engines) : [],
    basicAuthUsername: trimString(override?.basicAuthUsername ?? ''),
    basicAuthPassword: trimString(override?.basicAuthPassword ?? '')
  }
}

/**
 * `exa-mcp` and `exa` are both backed by the Exa API but expose separate provider
 * presets. The user configures the key once under "Exa"; when `exa-mcp` has no
 * keys of its own, share the `exa` provider's keys so MCP searches authenticate too.
 */
function inheritExaMcpApiKeys(
  provider: WebSearchProvider,
  providerOverrides: WebSearchProviderOverrides
): WebSearchProvider {
  if (provider.id !== 'exa-mcp' || provider.apiKeys.length > 0) {
    return provider
  }

  const exaKeys = providerOverrides.exa?.apiKeys ? trimStringList(providerOverrides.exa.apiKeys) : []

  if (exaKeys.length === 0) {
    return provider
  }

  return { ...provider, apiKeys: exaKeys }
}

/**
 * Zhipu web search authenticates with the same key as the Zhipu model provider, so its
 * settings section deliberately has no key input and points users at model provider
 * settings instead. Read that key at search time rather than mirroring it into a second
 * store, so rotating or disabling it there takes effect here too.
 */
function inheritZhipuModelProviderApiKeys(provider: WebSearchProvider): WebSearchProvider {
  if (provider.id !== 'zhipu') {
    return provider
  }

  let modelProviderKeys: string[] = []
  try {
    modelProviderKeys = trimStringList(providerService.getApiKeys('zhipu', { enabled: true }).map((entry) => entry.key))
  } catch {
    // No Zhipu model provider row: the user simply has not configured Zhipu at all.
    return { ...provider, apiKeys: [] }
  }

  return { ...provider, apiKeys: modelProviderKeys }
}

export function resolveProviders(providerOverrides: WebSearchProviderOverrides): WebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const provider = mergeWebSearchProviderPreset(preset, providerOverrides[preset.id])
    return inheritZhipuModelProviderApiKeys(inheritExaMcpApiKeys(provider, providerOverrides))
  })
}

export async function getRuntimeConfig(preferences: WebSearchPreferenceReader): Promise<WebSearchExecutionConfig> {
  const [maxResults, excludeDomains, method, cutoffLimit] = await Promise.all([
    preferences.get('chat.web_search.max_results'),
    preferences.get('chat.web_search.exclude_domains'),
    preferences.get('chat.web_search.compression.method'),
    preferences.get('chat.web_search.compression.cutoff_limit')
  ])

  return {
    maxResults: Math.max(1, maxResults),
    excludeDomains,
    compression: {
      method,
      cutoffLimit: normalizeWebSearchCutoffLimit(cutoffLimit)
    }
  }
}

export async function getResolvedConfig(preferences: WebSearchPreferenceReader): Promise<WebSearchResolvedConfig> {
  const [providerOverrides, runtime] = await Promise.all([
    getProviderOverrides(preferences),
    getRuntimeConfig(preferences)
  ])

  return {
    providers: resolveProviders(providerOverrides),
    runtime,
    providerOverrides
  }
}

export async function getProviderById<TProviderId extends WebSearchProvider['id']>(
  providerId: TProviderId,
  preferences: WebSearchPreferenceReader
): Promise<WebSearchProvider & { id: TProviderId }> {
  const providerOverrides = await getProviderOverrides(preferences)
  const override = providerOverrides[providerId]
  const preset = getWebSearchProviderPresetById(providerId)

  const provider = mergeWebSearchProviderPreset(preset, override)

  return inheritZhipuModelProviderApiKeys(inheritExaMcpApiKeys(provider, providerOverrides)) as WebSearchProvider & {
    id: TProviderId
  }
}

export async function getProviderForCapability(
  requestedProviderId: WebSearchProvider['id'] | undefined,
  capability: WebSearchCapability,
  preferences: WebSearchPreferenceReader
): Promise<WebSearchProvider> {
  const providerId = requestedProviderId ?? (await preferences.get(DEFAULT_PROVIDER_KEY_BY_CAPABILITY[capability]))

  if (!providerId) {
    throw new WebSearchConfigError(
      'provider_not_configured',
      `Default web search provider is not configured for capability ${capability}`
    )
  }

  const provider = await getProviderById(providerId, preferences)

  if (!provider.capabilities.some((providerCapability) => providerCapability.feature === capability)) {
    throw new WebSearchConfigError(
      'capability_unsupported',
      `Web search provider ${providerId} does not support capability ${capability}`
    )
  }

  return provider
}

/**
 * Permanent configuration failures are typed at their owning boundary so callers never infer
 * retryability from error-message text.
 */
export function isPermanentWebSearchConfigError(error: unknown): error is WebSearchConfigError {
  return error instanceof WebSearchConfigError
}
