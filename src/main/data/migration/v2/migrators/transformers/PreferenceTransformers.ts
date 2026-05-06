/**
 * Preference Transformers
 *
 * Pure transformation functions for complex preference migrations.
 * Each function takes source values and returns a record of target key -> value pairs.
 *
 * Design principles:
 * - Pure functions with no side effects
 * - Return empty object {} to skip all target keys
 * - Return undefined values to skip specific keys
 * - Handle missing/null source data gracefully
 *
 * ## Example Transformer Functions
 *
 * Below are example implementations for common transformation scenarios.
 * Copy and modify these examples when implementing actual transformers.
 *
 * ### Scenario 1: Object Splitting (1→N)
 *
 * Splits a windowBounds object into separate position and size preference keys.
 *
 * ```typescript
 * interface WindowBounds {
 *   x: number
 *   y: number
 *   width: number
 *   height: number
 * }
 *
 * export function splitWindowBounds(sources: { windowBounds?: WindowBounds }): TransformResult {
 *   const bounds = sources.windowBounds
 *
 *   // If no bounds data, return defaults
 *   if (!bounds) {
 *     return {
 *       'app.window.position.x': 0,
 *       'app.window.position.y': 0,
 *       'app.window.size.width': 800,
 *       'app.window.size.height': 600
 *     }
 *   }
 *
 *   return {
 *     'app.window.position.x': bounds.x ?? 0,
 *     'app.window.position.y': bounds.y ?? 0,
 *     'app.window.size.width': bounds.width ?? 800,
 *     'app.window.size.height': bounds.height ?? 600
 *   }
 * }
 *
 * // Input: { windowBounds: { x: 100, y: 200, width: 800, height: 600 } }
 * // Output: {
 * //   'app.window.position.x': 100,
 * //   'app.window.position.y': 200,
 * //   'app.window.size.width': 800,
 * //   'app.window.size.height': 600
 * // }
 * ```
 *
 * ### Scenario 2: Multi-source Merging (N→1)
 *
 * Merges proxy configuration from multiple sources into unified proxy settings.
 *
 * ```typescript
 * export function mergeProxyConfig(sources: {
 *   proxyEnabled?: boolean
 *   proxyHost?: string
 *   proxyPort?: number
 * }): TransformResult {
 *   // Skip if proxy is not enabled
 *   if (!sources.proxyEnabled) {
 *     return {}
 *   }
 *
 *   return {
 *     'network.proxy.enabled': sources.proxyEnabled,
 *     'network.proxy.host': sources.proxyHost ?? '',
 *     'network.proxy.port': sources.proxyPort ?? 0
 *   }
 * }
 *
 * // Input: { proxyEnabled: true, proxyHost: '127.0.0.1', proxyPort: 8080 }
 * // Output: {
 * //   'network.proxy.enabled': true,
 * //   'network.proxy.host': '127.0.0.1',
 * //   'network.proxy.port': 8080
 * // }
 * ```
 *
 * ### Scenario 3: Value Calculation/Transformation
 *
 * Converts shortcut string format to structured object format.
 *
 * ```typescript
 * interface ShortcutDefinition {
 *   key: string
 *   modifiers: string[]
 * }
 *
 * export function convertShortcutFormat(sources: { shortcutKey?: string }): TransformResult {
 *   if (!sources.shortcutKey) {
 *     return {}
 *   }
 *
 *   // Parse 'ctrl+shift+enter' → { key: 'enter', modifiers: ['ctrl', 'shift'] }
 *   const parts = sources.shortcutKey.toLowerCase().split('+')
 *   const key = parts.pop() ?? ''
 *   const modifiers = parts
 *
 *   return {
 *     'shortcut.send_message': { key, modifiers } satisfies ShortcutDefinition
 *   }
 * }
 *
 * // Input: { shortcutKey: 'ctrl+shift+enter' }
 * // Output: {
 * //   'shortcut.send_message': { key: 'enter', modifiers: ['ctrl', 'shift'] }
 * // }
 * ```
 *
 * ### Scenario 4: Conditional Mapping
 *
 * Migrates backup configuration based on backup type.
 *
 * ```typescript
 * export function migrateBackupConfig(sources: {
 *   backupType?: string
 *   webdavUrl?: string
 *   s3Bucket?: string
 * }): TransformResult {
 *   const result: TransformResult = {}
 *
 *   // WebDAV backup
 *   if (sources.backupType === 'webdav' && sources.webdavUrl) {
 *     result['data.backup.webdav.enabled'] = true
 *     result['data.backup.webdav.url'] = sources.webdavUrl
 *   }
 *
 *   // S3 backup
 *   if (sources.backupType === 's3' && sources.s3Bucket) {
 *     result['data.backup.s3.enabled'] = true
 *     result['data.backup.s3.bucket'] = sources.s3Bucket
 *   }
 *
 *   return result
 * }
 *
 * // Input: { backupType: 'webdav', webdavUrl: 'https://dav.example.com' }
 * // Output: {
 * //   'data.backup.webdav.enabled': true,
 * //   'data.backup.webdav.url': 'https://dav.example.com'
 * // }
 * ```
 */

import { loggerService } from '@logger'
import type {
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT, normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'

import type { TransformResult } from '../mappings/ComplexPreferenceMappings'

// Re-export TransformResult for convenience
export type { TransformResult }

const logger = loggerService.withContext('PreferenceTransformers')

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Helper to safely get nested property from unknown object
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Helper to check if value is a valid number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

/**
 * Helper to check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const SUPPORTED_WEB_SEARCH_PROVIDER_IDS = new Set<WebSearchProviderId>(
  PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => preset.id)
)

function isSupportedWebSearchProviderId(value: string): value is WebSearchProviderId {
  return SUPPORTED_WEB_SEARCH_PROVIDER_IDS.has(value as WebSearchProviderId)
}

// ============================================================================
// WebSearch Transformers
// ============================================================================

/**
 * Normalize the legacy default web search provider into a v2 Preference key.
 *
 * Unsupported legacy ids, removed local providers, and empty strings are all
 * treated as "no default provider selected" to keep the migrated Preference
 * compatible with the curated preset list.
 */
export function normalizeWebSearchDefaultProvider(sources: { defaultProvider?: string | null }): TransformResult {
  const defaultProvider = sources.defaultProvider?.trim()

  if (defaultProvider && !isSupportedWebSearchProviderId(defaultProvider)) {
    logger.warn('Unsupported legacy web-search default provider dropped during v2 migration', {
      providerId: defaultProvider
    })
  }

  return {
    'chat.web_search.default_provider':
      defaultProvider && isSupportedWebSearchProviderId(defaultProvider) ? defaultProvider : null
  }
}

/**
 * WebSearch compression config source type
 * Matches the actual Redux websearch.compressionConfig structure
 */
interface WebSearchCompressionConfigSource {
  method?: string
  cutoffLimit?: number | null
  cutoffUnit?: string
}

const WEB_SEARCH_COMPRESSION_METHODS = ['none', 'cutoff'] as const
const WEB_SEARCH_CUTOFF_UNITS = ['char', 'token'] as const

function isStringInList<const T extends readonly string[]>(value: unknown, list: T): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

function normalizeCompressionMethod(value: unknown): (typeof WEB_SEARCH_COMPRESSION_METHODS)[number] {
  if (value === 'rag') {
    logger.warn('Legacy web-search RAG compression downgraded to none during v2 migration')
  } else if (typeof value === 'string' && !isStringInList(value, WEB_SEARCH_COMPRESSION_METHODS)) {
    logger.warn('Unknown web-search compression method coerced to none during v2 migration', {
      method: value
    })
  }

  return isStringInList(value, WEB_SEARCH_COMPRESSION_METHODS) ? value : 'none'
}

function normalizeCutoffUnit(value: unknown): (typeof WEB_SEARCH_CUTOFF_UNITS)[number] {
  return isStringInList(value, WEB_SEARCH_CUTOFF_UNITS) ? value : 'char'
}

/**
 * Flatten websearch compressionConfig object into separate preference keys.
 *
 * @example
 * Input: {
 *   compressionConfig: {
 *     method: 'cutoff',
 *     cutoffLimit: 2000,
 *     cutoffUnit: 'token'
 *   }
 * }
 * Output: {
 *   'chat.web_search.compression.method': 'cutoff',
 *   'chat.web_search.compression.cutoff_limit': 2000,
 *   'chat.web_search.compression.cutoff_unit': 'token'
 * }
 */
export function flattenCompressionConfig(sources: {
  compressionConfig?: WebSearchCompressionConfigSource
}): TransformResult {
  const config = sources.compressionConfig

  // If no config, return defaults
  if (!config) {
    return {
      'chat.web_search.compression.method': 'none',
      'chat.web_search.compression.cutoff_limit': DEFAULT_WEB_SEARCH_CUTOFF_LIMIT,
      'chat.web_search.compression.cutoff_unit': 'char'
    }
  }

  const method = normalizeCompressionMethod(config.method)
  const cutoffUnit = normalizeCutoffUnit(config.cutoffUnit)

  return {
    'chat.web_search.compression.method': method,
    'chat.web_search.compression.cutoff_limit': normalizeWebSearchCutoffLimit(config.cutoffLimit),
    'chat.web_search.compression.cutoff_unit': cutoffUnit
  }
}

/**
 * Old WebSearch provider structure from Redux (missing type and other fields)
 */
interface OldWebSearchProvider {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  url?: string
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}

/**
 * Migrate websearch providers array into layered provider overrides.
 *
 * This function keeps only user-customized values that differ from preset defaults.
 * Fields that match preset values are dropped to keep `provider_overrides` minimal.
 * Providers without a matching built-in preset are ignored because v2 only supports
 * the curated preset list plus per-provider overrides.
 *
 * @example
 * Input: {
 *   providers: [
 *     { id: 'tavily', name: 'Tavily', apiKey: 'key1,key2', apiHost: 'https://api.tavily.com' },
 *     { id: 'exa-mcp', name: 'ExaMCP', apiHost: 'https://mcp.exa.ai/mcp' },
 *     { id: 'custom-provider', name: 'Custom', apiHost: 'https://custom.example.com/search' }
 *   ]
 * }
 * Output: {
 *   'chat.web_search.provider_overrides': {
 *     tavily: { apiKeys: ['key1', 'key2'] }
 *   }
 * }
 */
export function migrateWebSearchProviders(sources: { providers?: OldWebSearchProvider[] }): TransformResult {
  const providers = sources.providers
  const presetById = new Map<string, (typeof PRESETS_WEB_SEARCH_PROVIDERS)[number]>(
    PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => [preset.id, preset])
  )

  if (!providers || !Array.isArray(providers)) {
    return {
      'chat.web_search.provider_overrides': {}
    }
  }

  const overrides: WebSearchProviderOverrides = {}

  providers.forEach((provider) => {
    const override: WebSearchProviderOverride = {}
    const preset = presetById.get(provider.id)

    if (!preset) {
      logger.warn('Unsupported legacy web-search provider dropped during v2 migration', {
        providerId: provider.id
      })
      return
    }

    const apiKeys = provider.apiKey
      ?.split(',')
      .map((apiKey) => apiKey.trim())
      .filter(Boolean)
    if (apiKeys && apiKeys.length > 0) {
      override.apiKeys = apiKeys
    }

    const rawApiHost = provider.apiHost?.trim() ? provider.apiHost : provider.url
    const apiHost = rawApiHost?.trim()
    if (apiHost && apiHost !== preset.defaultApiHost) {
      override.apiHost = apiHost
    }

    if (provider.engines && provider.engines.length > 0) {
      override.engines = provider.engines
    }

    const basicAuthUsername = provider.basicAuthUsername?.trim()
    if (basicAuthUsername) {
      override.basicAuthUsername = basicAuthUsername
    }

    if (provider.basicAuthPassword) {
      override.basicAuthPassword = provider.basicAuthPassword
    }

    if (Object.keys(override).length > 0) {
      overrides[provider.id] = override
    }
  })

  return {
    'chat.web_search.provider_overrides': overrides
  }
}
