/**
 * Renderer-side IO helpers for WebSearch preferences. Pure transforms live
 * in `@shared/data/utils/webSearchPreferences`; this module wraps them with
 * `preferenceService` reads/writes.
 */

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { WebSearchState } from '@renderer/types'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchProviderId
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import {
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  WEB_SEARCH_PREFERENCE_KEYS,
  type WebSearchPreferenceValues,
  type WebSearchProviderFormUpdate
} from '@shared/data/utils/webSearchPreferences'

const logger = loggerService.withContext('WebSearchPreferences')

const WEB_SEARCH_PREFERENCE_ENTRIES = Object.entries(WEB_SEARCH_PREFERENCE_KEYS) as Array<
  [
    keyof typeof WEB_SEARCH_PREFERENCE_KEYS,
    (typeof WEB_SEARCH_PREFERENCE_KEYS)[keyof typeof WEB_SEARCH_PREFERENCE_KEYS]
  ]
>

const WEB_SEARCH_PREFERENCE_KEY_LIST = WEB_SEARCH_PREFERENCE_ENTRIES.map(([, key]) => key)

/** Build the renderer-side state object from a snapshot of preference values. */
export function buildRendererWebSearchState(preferences: WebSearchPreferenceValues): WebSearchState {
  const defaultProvider = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.defaultProvider,
    preferences.defaultProvider
  )
  const excludeDomains = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.excludeDomains, preferences.excludeDomains)
  const maxResults = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.maxResults, preferences.maxResults)
  const providerOverrides = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.providerOverrides,
    preferences.providerOverrides
  )
  const searchWithTime = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.searchWithTime, preferences.searchWithTime)
  const subscribeSources = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.subscribeSources,
    preferences.subscribeSources
  )
  const compressionMethod = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.compressionMethod,
    preferences.compressionMethod
  )
  const cutoffLimit = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.cutoffLimit, preferences.cutoffLimit)
  const cutoffUnit = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.cutoffUnit, preferences.cutoffUnit)

  return {
    defaultProvider,
    providers: resolveWebSearchProviders(providerOverrides),
    searchWithTime,
    maxResults: Math.max(1, maxResults),
    excludeDomains,
    subscribeSources,
    compressionConfig: {
      method: compressionMethod,
      cutoffLimit: normalizeWebSearchCutoffLimit(cutoffLimit),
      cutoffUnit
    }
  }
}

/** Async load the full state (preference cache may not be warm yet). */
export async function getRendererWebSearchState(): Promise<WebSearchState> {
  const preferences = await preferenceService.getMultiple(WEB_SEARCH_PREFERENCE_KEYS)
  return buildRendererWebSearchState(preferences)
}

/** Sync read from the renderer preference cache. Returns null when the cache
 *  hasn't yet warmed for any of the 9 web-search keys. */
export function getCachedRendererWebSearchState(): WebSearchState | null {
  const missingKeys = WEB_SEARCH_PREFERENCE_KEY_LIST.filter((key) => !preferenceService.isCached(key))

  if (missingKeys.length > 0) {
    logger.warn('Web search preference cache is not ready; skip sync state read', { missingKeys })
    return null
  }

  const getCachedPreference = <K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] => {
    const cachedValue = preferenceService.getCachedValue(key)
    return (cachedValue !== undefined ? cachedValue : getDefaultValue(key)) as PreferenceDefaultScopeType[K]
  }

  const preferences = Object.fromEntries(
    WEB_SEARCH_PREFERENCE_ENTRIES.map(([alias, key]) => [alias, getCachedPreference(key)])
  ) as WebSearchPreferenceValues

  return buildRendererWebSearchState(preferences)
}

/** Patch one provider's override (form-shape input) and persist via preferenceService. */
export async function updateWebSearchProviderPreferenceOverride(
  providerId: WebSearchProviderId,
  updates: WebSearchProviderFormUpdate
): Promise<void> {
  const currentOverrides = await preferenceService.get(WEB_SEARCH_PREFERENCE_KEYS.providerOverrides)
  const nextOverrides = updateWebSearchProviderOverride(currentOverrides ?? {}, providerId, updates)
  await preferenceService.set(WEB_SEARCH_PREFERENCE_KEYS.providerOverrides, nextOverrides)
}

function getPreferenceOrDefault<K extends PreferenceKeyType>(
  key: K,
  value: PreferenceDefaultScopeType[K] | null | undefined
): PreferenceDefaultScopeType[K] {
  const defaultValue = getDefaultValue(key)
  if (value === undefined || (value === null && defaultValue !== null)) {
    return defaultValue as PreferenceDefaultScopeType[K]
  }
  return value as PreferenceDefaultScopeType[K]
}
