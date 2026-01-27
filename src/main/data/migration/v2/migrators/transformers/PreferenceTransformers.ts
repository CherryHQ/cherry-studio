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
