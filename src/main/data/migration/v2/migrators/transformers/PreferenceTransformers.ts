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

import type { TransformResult } from '../mappings/ComplexPreferenceMappings'

// Re-export TransformResult for convenience
export type { TransformResult }

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

// ============================================================================
// WebSearch Transformers
// ============================================================================

/**
 * WebSearch compression config source type
 * Matches the actual Redux websearch.compressionConfig structure
 */
interface WebSearchCompressionConfigSource {
  method?: string
  cutoffLimit?: number | null
  cutoffUnit?: string
  documentCount?: number
  embeddingModel?: { id?: string; provider?: string } | null
  embeddingDimensions?: number | null
  rerankModel?: { id?: string; provider?: string } | null
}

/**
 * Flatten websearch compressionConfig object into separate preference keys.
 *
 * Transforms nested model objects (embeddingModel, rerankModel) into flat id/provider keys.
 *
 * @example
 * Input: {
 *   compressionConfig: {
 *     method: 'rag',
 *     documentCount: 5,
 *     embeddingModel: { id: 'model-1', provider: 'openai' },
 *     rerankModel: { id: 'rerank-1', provider: 'cohere' }
 *   }
 * }
 * Output: {
 *   'chat.websearch.compression.method': 'rag',
 *   'chat.websearch.compression.rag_document_count': 5,
 *   'chat.websearch.compression.rag_embedding_model_id': 'model-1',
 *   'chat.websearch.compression.rag_embedding_provider_id': 'openai',
 *   ...
 * }
 */
export function flattenCompressionConfig(sources: {
  compressionConfig?: WebSearchCompressionConfigSource
}): TransformResult {
  const config = sources.compressionConfig

  // If no config, return defaults
  if (!config) {
    return {
      'chat.websearch.compression.method': 'none',
      'chat.websearch.compression.cutoff_limit': null,
      'chat.websearch.compression.cutoff_unit': 'char',
      'chat.websearch.compression.rag_document_count': 5,
      'chat.websearch.compression.rag_embedding_model_id': null,
      'chat.websearch.compression.rag_embedding_provider_id': null,
      'chat.websearch.compression.rag_embedding_dimensions': null,
      'chat.websearch.compression.rag_rerank_model_id': null,
      'chat.websearch.compression.rag_rerank_provider_id': null
    }
  }

  return {
    'chat.websearch.compression.method': config.method ?? 'none',
    'chat.websearch.compression.cutoff_limit': config.cutoffLimit ?? null,
    'chat.websearch.compression.cutoff_unit': config.cutoffUnit ?? 'char',
    'chat.websearch.compression.rag_document_count': config.documentCount ?? 5,
    'chat.websearch.compression.rag_embedding_model_id': config.embeddingModel?.id ?? null,
    'chat.websearch.compression.rag_embedding_provider_id': config.embeddingModel?.provider ?? null,
    'chat.websearch.compression.rag_embedding_dimensions': config.embeddingDimensions ?? null,
    'chat.websearch.compression.rag_rerank_model_id': config.rerankModel?.id ?? null,
    'chat.websearch.compression.rag_rerank_provider_id': config.rerankModel?.provider ?? null
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
  basicAuthUsername?: string
  basicAuthPassword?: string
}

/**
 * New WebSearch provider structure with all required fields
 */
interface NewWebSearchProvider {
  id: string
  name: string
  type: 'api' | 'local'
  apiKey: string
  apiHost: string
  engines: string[]
  usingBrowser: boolean
  basicAuthUsername: string
  basicAuthPassword: string
}

/**
 * Migrate websearch providers array, adding missing fields.
 *
 * The old Redux data doesn't have 'type' field, which is required by the new system.
 * This function:
 * - Adds 'type' field based on provider id (local-* = 'local', others = 'api')
 * - Adds missing fields with default values (engines, usingBrowser, etc.)
 *
 * @example
 * Input: {
 *   providers: [
 *     { id: 'tavily', name: 'Tavily', apiKey: '...', apiHost: '...' },
 *     { id: 'local-google', name: 'Google', url: '...' }
 *   ]
 * }
 * Output: {
 *   'chat.websearch.providers': [
 *     { id: 'tavily', name: 'Tavily', type: 'api', apiKey: '...', apiHost: '...', engines: [], ... },
 *     { id: 'local-google', name: 'Google', type: 'local', apiKey: '', apiHost: '', engines: [], ... }
 *   ]
 * }
 */
export function migrateWebSearchProviders(sources: { providers?: OldWebSearchProvider[] }): TransformResult {
  const providers = sources.providers

  // If no providers, return empty array
  if (!providers || !Array.isArray(providers)) {
    return {
      'chat.websearch.providers': []
    }
  }

  const migratedProviders: NewWebSearchProvider[] = providers.map((p) => {
    // Determine type based on id prefix
    const type: 'api' | 'local' = p.id.startsWith('local-') ? 'local' : 'api'

    return {
      id: p.id,
      name: p.name,
      type,
      apiKey: p.apiKey ?? '',
      apiHost: p.apiHost ?? '',
      engines: [],
      usingBrowser: false,
      basicAuthUsername: p.basicAuthUsername ?? '',
      basicAuthPassword: p.basicAuthPassword ?? ''
    }
  })

  return {
    'chat.websearch.providers': migratedProviders
  }
}
