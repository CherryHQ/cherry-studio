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

import { type FileProcessorTemplate, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'

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
// File Processing Migration
// ============================================================================

/**
 * Get processor template by ID from presets
 */
function getTemplate(processorId: string): FileProcessorTemplate | undefined {
  return PRESETS_FILE_PROCESSORS.find((template) => template.id === processorId)
}

/**
 * Legacy OCR Provider type (for migration)
 */
interface LegacyOcrProvider {
  id: string
  name: string
  config?: {
    api?: {
      apiKey?: string
      apiHost?: string
    }
    langs?: Record<string, boolean>
    apiUrl?: string
    accessToken?: string
  }
}

/**
 * Legacy Preprocess Provider type (for migration)
 */
interface LegacyPreprocessProvider {
  id: string
  name: string
  apiKey?: string
  apiHost?: string
  model?: string
}

/**
 * Capability override (for migration)
 */
type CapabilityOverride = {
  apiHost?: string
  modelId?: string
}

type FileProcessorFeature = 'text_extraction' | 'markdown_conversion'

/**
 * User override for file processor (target format)
 */
interface FileProcessorOverride {
  apiKeys?: string[]
  capabilities?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
  options?: Record<string, unknown>
}

type FileProcessorOverrides = Record<string, FileProcessorOverride>

function normalizeApiHost(value?: string): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function normalizeModelId(value?: string): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function getTemplateDefaults(processorId: string, feature: FileProcessorFeature): CapabilityOverride {
  const template = getTemplate(processorId)
  const capability = template?.capabilities.find((item) => item.feature === feature)
  return {
    apiHost: normalizeApiHost(capability?.apiHost),
    modelId: normalizeModelId(capability?.modelId)
  }
}

function mergeCapabilities(
  base?: Partial<Record<FileProcessorFeature, CapabilityOverride>>,
  incoming?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
): Partial<Record<FileProcessorFeature, CapabilityOverride>> | undefined {
  if (!base && !incoming) return undefined
  if (!base) return incoming ? { ...incoming } : undefined
  if (!incoming) return { ...base }

  const merged = { ...base }
  for (const [feature, cap] of Object.entries(incoming) as [FileProcessorFeature, CapabilityOverride][]) {
    merged[feature] = { ...merged[feature], ...cap }
  }

  return merged
}

function mergeOverrides(
  existing: FileProcessorOverride | undefined,
  next: FileProcessorOverride
): FileProcessorOverride {
  if (!existing) return next

  return {
    apiKeys: next.apiKeys ?? existing.apiKeys,
    capabilities: mergeCapabilities(existing.capabilities, next.capabilities),
    options: existing.options || next.options ? { ...existing.options, ...next.options } : undefined
  }
}

/**
 * Extract user config from OCR provider
 * Only extracts fields that differ from defaults
 */
function extractOcrUserConfig(provider: LegacyOcrProvider): FileProcessorOverride | null {
  const userConfig: FileProcessorOverride = {}
  let hasUserConfig = false
  const capabilities: Partial<Record<FileProcessorFeature, CapabilityOverride>> = {}

  // Extract API config (for API-based providers like paddleocr)
  if (provider.config?.api?.apiKey) {
    userConfig.apiKeys = [provider.config.api.apiKey]
    hasUserConfig = true
  }

  // Only store apiHost if different from template default
  const defaultOcrApiHost = getTemplateDefaults(provider.id, 'text_extraction').apiHost
  const apiHost = normalizeApiHost(provider.config?.api?.apiHost)
  if (apiHost && apiHost !== defaultOcrApiHost) {
    capabilities['text_extraction'] = { ...capabilities['text_extraction'], apiHost }
    hasUserConfig = true
  }

  // Extract PaddleOCR specific config (apiUrl as apiHost)
  const apiUrlHost = normalizeApiHost(provider.config?.apiUrl)
  if (apiUrlHost) {
    capabilities['text_extraction'] = { ...capabilities['text_extraction'], apiHost: apiUrlHost }
    hasUserConfig = true
  }
  if (provider.config?.accessToken) {
    userConfig.apiKeys = [provider.config.accessToken]
    hasUserConfig = true
  }

  // Extract Tesseract language config (convert object to array)
  if (provider.config?.langs && typeof provider.config.langs === 'object') {
    const enabledLangs = Object.entries(provider.config.langs)
      .filter(([, enabled]) => enabled === true)
      .map(([lang]) => lang)

    if (enabledLangs.length > 0) {
      userConfig.options = { langs: enabledLangs }
      hasUserConfig = true
    }
  }

  // Add capabilities if any
  if (Object.keys(capabilities).length > 0) {
    userConfig.capabilities = capabilities
  }

  return hasUserConfig ? userConfig : null
}

/**
 * Extract user config from Preprocess provider
 * Only extracts fields that differ from defaults
 */
function extractPreprocessUserConfig(provider: LegacyPreprocessProvider): FileProcessorOverride | null {
  const userConfig: FileProcessorOverride = {}
  let hasUserConfig = false
  const capabilityOverride: CapabilityOverride = {}
  let hasCapabilityOverride = false

  if (provider.apiKey) {
    userConfig.apiKeys = [provider.apiKey]
    hasUserConfig = true
  }

  // Only store apiHost if different from template default
  const defaults = getTemplateDefaults(provider.id, 'markdown_conversion')
  const apiHost = normalizeApiHost(provider.apiHost)
  if (apiHost && apiHost !== defaults.apiHost) {
    capabilityOverride.apiHost = apiHost
    hasCapabilityOverride = true
    hasUserConfig = true
  }

  // Only store modelId if different from template default
  const modelId = normalizeModelId(provider.model)
  if (modelId && modelId !== defaults.modelId) {
    capabilityOverride.modelId = modelId
    hasCapabilityOverride = true
    hasUserConfig = true
  }

  // Add capability override if any field was set
  if (hasCapabilityOverride) {
    userConfig.capabilities = { markdown_conversion: capabilityOverride }
  }

  return hasUserConfig ? userConfig : null
}

/**
 * Transform OCR + Preprocess providers to unified FileProcessorOverrides
 *
 * This transformer handles:
 * 1. OCR providers (tesseract, system, paddleocr, ovocr)
 * 2. Preprocess providers (mineru, doc2x, mistral, open-mineru)
 * 3. Merging configs if same processor ID exists in both sources
 * 4. Only storing user-modified fields (not defaults)
 */
export function transformFileProcessingConfig(sources: Record<string, unknown>): TransformResult {
  const ocrProviders = sources.ocrProviders as LegacyOcrProvider[] | undefined
  const ocrImageProviderId = sources.ocrImageProviderId as string | undefined
  const preprocessProviders = sources.preprocessProviders as LegacyPreprocessProvider[] | undefined
  const preprocessDefaultProvider = sources.preprocessDefaultProvider as string | undefined

  const overrides: FileProcessorOverrides = {}

  // 1. Migrate OCR user configs
  if (Array.isArray(ocrProviders)) {
    for (const provider of ocrProviders) {
      const override = extractOcrUserConfig(provider)
      if (override) {
        overrides[provider.id] = mergeOverrides(overrides[provider.id], override)
      }
    }
  }

  // 2. Migrate Preprocess user configs (merge with existing if same ID)
  if (Array.isArray(preprocessProviders)) {
    for (const provider of preprocessProviders) {
      const override = extractPreprocessUserConfig(provider)
      if (override) {
        overrides[provider.id] = mergeOverrides(overrides[provider.id], override)
      }
    }
  }

  // Build result - undefined values will be skipped
  const hasOverrides = Object.keys(overrides).length > 0
  return {
    'feature.file_processing.overrides': hasOverrides ? overrides : undefined,
    'feature.file_processing.default_text_extraction_processor': isNonEmptyString(ocrImageProviderId)
      ? ocrImageProviderId
      : undefined,
    'feature.file_processing.default_markdown_conversion_processor': isNonEmptyString(preprocessDefaultProvider)
      ? preprocessDefaultProvider
      : undefined
  }
}
