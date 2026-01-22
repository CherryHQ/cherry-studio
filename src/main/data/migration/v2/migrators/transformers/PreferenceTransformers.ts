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
// File Processing Migration
// ============================================================================

/**
 * Default API hosts for file processors (from template)
 * Used to determine if user has modified the default value
 */
const FILE_PROCESSOR_DEFAULT_API_HOSTS: Record<string, string> = {
  mineru: 'https://mineru.net',
  doc2x: 'https://v2.doc2x.noedgeai.com',
  mistral: 'https://api.mistral.ai'
}

/**
 * Default model IDs for file processors (from template)
 */
const FILE_PROCESSOR_DEFAULT_MODEL_IDS: Record<string, string> = {
  mistral: 'mistral-ocr-latest'
}

/**
 * Get template default API host for a processor
 */
function getTemplateDefaultApiHost(processorId: string): string | undefined {
  return FILE_PROCESSOR_DEFAULT_API_HOSTS[processorId]
}

/**
 * Get template default model ID for a processor
 */
function getTemplateDefaultModelId(processorId: string): string | undefined {
  return FILE_PROCESSOR_DEFAULT_MODEL_IDS[processorId]
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
 * Feature-level user configuration (for migration)
 */
interface FeatureUserConfig {
  feature: 'text_extraction' | 'to_markdown'
  apiHost?: string
  modelId?: string
}

/**
 * User config for file processor (target format)
 */
interface FileProcessorUserConfig {
  id: string
  apiKey?: string
  featureConfigs?: FeatureUserConfig[]
  options?: Record<string, unknown>
}

/**
 * Extract user config from OCR provider
 * Only extracts fields that differ from defaults
 */
function extractOcrUserConfig(provider: LegacyOcrProvider): FileProcessorUserConfig | null {
  const userConfig: FileProcessorUserConfig = { id: provider.id }
  let hasUserConfig = false
  const featureConfigs: FeatureUserConfig[] = []

  // Extract API config (for API-based providers like paddleocr)
  if (provider.config?.api?.apiKey) {
    userConfig.apiKey = provider.config.api.apiKey
    hasUserConfig = true
  }

  // Only store apiHost if different from template default (store in featureConfigs)
  const defaultApiHost = getTemplateDefaultApiHost(provider.id)
  if (provider.config?.api?.apiHost && provider.config.api.apiHost !== defaultApiHost) {
    featureConfigs.push({
      feature: 'text_extraction',
      apiHost: provider.config.api.apiHost
    })
    hasUserConfig = true
  }

  // Extract PaddleOCR specific config (apiUrl as apiHost)
  if (provider.config?.apiUrl) {
    // Check if we already have a featureConfig for text_extraction
    const existingConfig = featureConfigs.find((fc) => fc.feature === 'text_extraction')
    if (existingConfig) {
      existingConfig.apiHost = provider.config.apiUrl
    } else {
      featureConfigs.push({
        feature: 'text_extraction',
        apiHost: provider.config.apiUrl
      })
    }
    hasUserConfig = true
  }
  if (provider.config?.accessToken) {
    userConfig.apiKey = provider.config.accessToken
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

  // Add featureConfigs if any
  if (featureConfigs.length > 0) {
    userConfig.featureConfigs = featureConfigs
  }

  return hasUserConfig ? userConfig : null
}

/**
 * Extract user config from Preprocess provider
 * Only extracts fields that differ from defaults
 */
function extractPreprocessUserConfig(provider: LegacyPreprocessProvider): FileProcessorUserConfig | null {
  const userConfig: FileProcessorUserConfig = { id: provider.id }
  let hasUserConfig = false
  const featureConfigs: FeatureUserConfig[] = []

  if (provider.apiKey) {
    userConfig.apiKey = provider.apiKey
    hasUserConfig = true
  }

  // Build featureConfig for to_markdown feature
  const featureConfig: FeatureUserConfig = { feature: 'to_markdown' }
  let hasFeatureConfig = false

  // Only store apiHost if different from template default
  const defaultApiHost = getTemplateDefaultApiHost(provider.id)
  if (provider.apiHost && provider.apiHost !== defaultApiHost) {
    featureConfig.apiHost = provider.apiHost
    hasFeatureConfig = true
    hasUserConfig = true
  }

  // Only store modelId if different from template default
  const defaultModelId = getTemplateDefaultModelId(provider.id)
  if (provider.model && provider.model !== defaultModelId) {
    featureConfig.modelId = provider.model
    hasFeatureConfig = true
    hasUserConfig = true
  }

  // Add featureConfig if any field was set
  if (hasFeatureConfig) {
    featureConfigs.push(featureConfig)
    userConfig.featureConfigs = featureConfigs
  }

  return hasUserConfig ? userConfig : null
}

/**
 * Transform OCR + Preprocess providers to unified FileProcessorUserConfig[]
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

  const userConfigs: FileProcessorUserConfig[] = []

  // 1. Migrate OCR user configs
  if (Array.isArray(ocrProviders)) {
    for (const provider of ocrProviders) {
      const userConfig = extractOcrUserConfig(provider)
      if (userConfig) {
        userConfigs.push(userConfig)
      }
    }
  }

  // 2. Migrate Preprocess user configs (merge with existing if same ID)
  if (Array.isArray(preprocessProviders)) {
    for (const provider of preprocessProviders) {
      const userConfig = extractPreprocessUserConfig(provider)
      if (userConfig) {
        const existingIndex = userConfigs.findIndex((c) => c.id === userConfig.id)
        if (existingIndex >= 0) {
          // Merge configs (preprocess values take precedence for shared fields)
          const existingConfig = userConfigs[existingIndex]

          // Merge featureConfigs arrays
          const mergedFeatureConfigs = [...(existingConfig.featureConfigs || [])]
          if (userConfig.featureConfigs) {
            for (const newFeatureConfig of userConfig.featureConfigs) {
              const existingFeatureIndex = mergedFeatureConfigs.findIndex(
                (fc) => fc.feature === newFeatureConfig.feature
              )
              if (existingFeatureIndex >= 0) {
                // Merge with existing feature config
                mergedFeatureConfigs[existingFeatureIndex] = {
                  ...mergedFeatureConfigs[existingFeatureIndex],
                  ...newFeatureConfig
                }
              } else {
                mergedFeatureConfigs.push(newFeatureConfig)
              }
            }
          }

          userConfigs[existingIndex] = {
            ...existingConfig,
            ...userConfig,
            // Merge featureConfigs
            featureConfigs: mergedFeatureConfigs.length > 0 ? mergedFeatureConfigs : undefined,
            // Merge options if both exist
            options:
              existingConfig.options || userConfig.options
                ? { ...existingConfig.options, ...userConfig.options }
                : undefined
          }
        } else {
          userConfigs.push(userConfig)
        }
      }
    }
  }

  // Build result - undefined values will be skipped
  return {
    'feature.file_processing.processors': userConfigs.length > 0 ? userConfigs : undefined,
    'feature.file_processing.default_image_processor': isNonEmptyString(ocrImageProviderId)
      ? ocrImageProviderId
      : undefined,
    'feature.file_processing.default_document_processor': isNonEmptyString(preprocessDefaultProvider)
      ? preprocessDefaultProvider
      : undefined
  }
}
