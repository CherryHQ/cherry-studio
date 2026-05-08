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
 * 1. Define transformation function in a colocated mapping file under `mappings/`
 * 2. Add mapping configuration to COMPLEX_PREFERENCE_MAPPINGS below
 * 3. Add target key definitions in target-key-definitions.json
 *
 * IMPORTANT: Ensure no conflicts between simple mappings and complex mappings.
 * The system uses strict mode - conflicts will cause errors at runtime.
 */

import { legacyModelJsonToUniqueId } from '../transformers/ModelTransformers'
import {
  flattenCompressionConfig,
  migrateWebSearchProviders,
  normalizeWebSearchDefaultProvider
} from '../transformers/PreferenceTransformers'
import { transformCodeCli } from './CodeCliTransforms'
import { mergeFileProcessingOverrides } from './FileProcessingOverrideMappings'
import { transformLlmModelIds } from './LlmModelTransforms'
import { SHORTCUT_TARGET_KEYS, transformShortcuts } from './ShortcutMappings'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Source definition for reading data from original storage
 */
export interface SourceDefinition {
  /** Data source type */
  source: 'electronStore' | 'redux' | 'dexie-settings' | 'localStorage'
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
  // WebSearch default provider normalization
  {
    id: 'websearch_default_provider_migrate',
    description: 'Normalize legacy websearch default provider into the v2 keyword-search default provider key',
    sources: {
      defaultProvider: { source: 'redux', category: 'websearch', key: 'defaultProvider' }
    },
    targetKeys: ['chat.web_search.default_search_keywords_provider'],
    transform: normalizeWebSearchDefaultProvider
  },

  // WebSearch provider overrides migration
  {
    id: 'websearch_providers_migrate',
    description: 'Migrate websearch providers array into provider overrides',
    sources: {
      providers: { source: 'redux', category: 'websearch', key: 'providers' }
    },
    targetKeys: ['chat.web_search.provider_overrides'],
    transform: migrateWebSearchProviders
  },

  // WebSearch compression config flattening
  {
    id: 'websearch_compression_flatten',
    description: 'Flatten websearch compressionConfig object into separate preference keys',
    sources: {
      compressionConfig: { source: 'redux', category: 'websearch', key: 'compressionConfig' }
    },
    targetKeys: [
      'chat.web_search.compression.method',
      'chat.web_search.compression.cutoff_limit',
      'chat.web_search.compression.cutoff_unit'
    ],
    transform: flattenCompressionConfig
  },

  // CodeCLI layered preset overrides
  {
    id: 'code_cli_overrides',
    description: 'Merge codeTools per-tool data (models, env vars, directories) into layered preset overrides',
    sources: {
      selectedModels: { source: 'redux', category: 'codeTools', key: 'selectedModels' },
      environmentVariables: { source: 'redux', category: 'codeTools', key: 'environmentVariables' },
      directories: { source: 'redux', category: 'codeTools', key: 'directories' },
      currentDirectory: { source: 'redux', category: 'codeTools', key: 'currentDirectory' },
      selectedCliTool: { source: 'redux', category: 'codeTools', key: 'selectedCliTool' },
      selectedTerminal: { source: 'redux', category: 'codeTools', key: 'selectedTerminal' }
    },
    targetKeys: ['feature.code_cli.overrides'],
    transform: transformCodeCli
  },

  // Shortcut preferences (legacy array → per-key PreferenceShortcutType)
  {
    id: 'shortcut_preferences_migrate',
    description: 'Convert legacy shortcuts array into per-key { binding, enabled } preferences',
    sources: {
      shortcuts: { source: 'redux', category: 'shortcuts', key: 'shortcuts' }
    },
    targetKeys: [...SHORTCUT_TARGET_KEYS],
    transform: transformShortcuts
  },

  // Sidebar icons: rewrite 'minapp' → 'mini_app' (v1→v2 rename)
  {
    id: 'sidebar_icons_rename',
    description: "Rewrite legacy 'minapp' icon key to 'mini_app' in sidebar icon arrays",
    sources: {
      visible: { source: 'redux', category: 'settings', key: 'sidebarIcons.visible' },
      disabled: { source: 'redux', category: 'settings', key: 'sidebarIcons.disabled' }
    },
    targetKeys: ['ui.sidebar.icons.visible', 'ui.sidebar.icons.invisible'],
    transform: (sources) => {
      const rewrite = (arr: unknown): unknown =>
        Array.isArray(arr) ? arr.map((v) => (v === 'minapp' ? 'mini_app' : v)) : arr
      return {
        'ui.sidebar.icons.visible': rewrite(sources.visible),
        'ui.sidebar.icons.invisible': rewrite(sources.disabled)
      }
    }
  },

  // File processing overrides merging
  {
    id: 'file_processing_overrides_merge',
    description: 'Merge legacy OCR and preprocess providers into file processing overrides',
    sources: {
      preprocessProviders: { source: 'redux', category: 'preprocess', key: 'providers' },
      ocrProviders: { source: 'redux', category: 'ocr', key: 'providers' }
    },
    targetKeys: ['feature.file_processing.overrides'],
    transform: mergeFileProcessingOverrides
  },

  // LLM model ID migration (Model object → UniqueModelId)
  {
    id: 'llm_model_ids_to_unique',
    description: 'Convert legacy LLM Model objects (provider + id) into UniqueModelId format (provider::modelId)',
    sources: {
      defaultModel: { source: 'redux', category: 'llm', key: 'defaultModel' },
      topicNamingModel: { source: 'redux', category: 'llm', key: 'topicNamingModel' },
      quickModel: { source: 'redux', category: 'llm', key: 'quickModel' },
      translateModel: { source: 'redux', category: 'llm', key: 'translateModel' }
    },
    targetKeys: [
      'chat.default_model_id',
      'topic.naming.model_id',
      'feature.quick_assistant.model_id',
      'feature.translate.model_id'
    ],
    transform: transformLlmModelIds
  },

  // OpenClaw preferences migration (legacy port + JSON model string → v2 preferences)
  {
    id: 'openclaw_preferences',
    description: 'Convert legacy OpenClaw port and selected model JSON string into v2 preferences',
    sources: {
      gatewayPort: { source: 'redux', category: 'openclaw', key: 'gatewayPort' },
      selectedModelUniqId: { source: 'redux', category: 'openclaw', key: 'selectedModelUniqId' }
    },
    targetKeys: ['feature.openclaw.gateway_port', 'feature.openclaw.selected_model_id'],
    transform: (sources) => ({
      'feature.openclaw.gateway_port': sources.gatewayPort,
      'feature.openclaw.selected_model_id': legacyModelJsonToUniqueId(sources.selectedModelUniqId)
    })
  }
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
