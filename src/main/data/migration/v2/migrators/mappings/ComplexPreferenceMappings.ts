/**
 * Complex Preference Mappings
 *
 * This module defines complex preference transformations that cannot be handled
 * by simple one-to-one mappings. It supports:
 *
 * 1. Object splitting (1→N): One source object splits into multiple preference keys
 * 2. Multi-source merging (N→1): Multiple sources merge into one or more targets
 * 3. Value calculation/transformation: Values need computation or format conversion
 * 4. Conditional mapping: Target keys determined by source values
 *
 * Usage:
 * 1. Define transformation function in PreferenceTransformers.ts
 * 2. Add mapping configuration to COMPLEX_PREFERENCE_MAPPINGS below
 * 3. Add target key definitions in target-key-definitions.json
 *
 * IMPORTANT: Ensure no conflicts between simple mappings and complex mappings.
 * The system uses strict mode - conflicts will cause errors at runtime.
 */

import { transformFileProcessingConfig } from '../transformers/PreferenceTransformers'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Source definition for reading data from original storage
 */
export interface SourceDefinition {
  /** Data source type */
  source: 'electronStore' | 'redux'
  /** Key path to read from source */
  key: string
  /** Redux category (required for redux source) */
  category?: string
}

/**
 * Transform result type - maps target keys to their values
 */
export type TransformResult = Record<string, unknown>

/**
 * Transform function signature
 * @param sources - Collected source values keyed by source name
 * @returns Record of targetKey -> value pairs
 */
export type TransformFunction = (sources: Record<string, unknown>) => TransformResult

/**
 * Complex mapping definition
 */
export interface ComplexMapping {
  /** Unique identifier for this mapping (used for error reporting and tracking) */
  id: string
  /** Human-readable description of what this mapping does */
  description: string
  /** Source data definitions - key is the name used in transform function */
  sources: Record<string, SourceDefinition>
  /** Target preference keys that this mapping produces (for validation) */
  targetKeys: string[]
  /** Transformation function that converts sources to target values */
  transform: TransformFunction
}

// ============================================================================
// Complex Mappings Configuration
// ============================================================================

/**
 * All complex preference mappings
 *
 * Add new complex mappings here. Each mapping must:
 * 1. Have a unique id
 * 2. Define all source data it needs
 * 3. List all target keys it produces
 * 4. Provide a transformation function
 *
 * Remember to also define the target keys in target-key-definitions.json!
 */
export const COMPLEX_PREFERENCE_MAPPINGS: ComplexMapping[] = [
  // File Processing Migration
  // Migrates OCR + Preprocess providers to unified file processing config
  {
    id: 'file-processing-config',
    description: 'Migrate OCR + Preprocess providers to unified file processing overrides',
    sources: {
      ocrProviders: { source: 'redux', category: 'ocr', key: 'providers' },
      ocrImageProviderId: { source: 'redux', category: 'ocr', key: 'imageProviderId' },
      preprocessProviders: { source: 'redux', category: 'preprocess', key: 'providers' },
      preprocessDefaultProvider: { source: 'redux', category: 'preprocess', key: 'defaultProvider' }
    },
    targetKeys: [
      'feature.file_processing.overrides',
      'feature.file_processing.default_text_extraction_processor',
      'feature.file_processing.default_markdown_conversion_processor'
    ],
    transform: transformFileProcessingConfig
  }

  // Example mappings (commented out - uncomment when needed):
  //
  // {
  //   id: 'window_bounds_split',
  //   description: 'Split windowBounds object into separate position and size keys',
  //   sources: {
  //     windowBounds: { source: 'electronStore', key: 'windowBounds' }
  //   },
  //   targetKeys: [
  //     'app.window.position.x',
  //     'app.window.position.y',
  //     'app.window.size.width',
  //     'app.window.size.height'
  //   ],
  //   transform: splitWindowBounds
  // },
  //
  // {
  //   id: 'proxy_config_merge',
  //   description: 'Merge proxy configuration from multiple sources',
  //   sources: {
  //     proxyEnabled: { source: 'redux', category: 'settings', key: 'proxyEnabled' },
  //     proxyHost: { source: 'redux', category: 'settings', key: 'proxyHost' },
  //     proxyPort: { source: 'electronStore', key: 'ProxyPort' }
  //   },
  //   targetKeys: ['network.proxy.enabled', 'network.proxy.host', 'network.proxy.port'],
  //   transform: mergeProxyConfig
  // }
]

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all target keys from complex mappings (for conflict detection)
 */
export function getComplexMappingTargetKeys(): string[] {
  return COMPLEX_PREFERENCE_MAPPINGS.flatMap((m) => m.targetKeys)
}

/**
 * Get complex mapping by id
 */
export function getComplexMappingById(id: string): ComplexMapping | undefined {
  return COMPLEX_PREFERENCE_MAPPINGS.find((m) => m.id === id)
}
