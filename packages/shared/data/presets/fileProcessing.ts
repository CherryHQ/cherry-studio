/**
 * File Processing Presets
 *
 * Templates are read-only metadata about processors.
 * User overrides are stored separately in preferences.
 *
 * i18n: Display names use `processor.${id}.name`
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Processor service type
 */
export type FileProcessorType = 'api' | 'builtin'

/**
 * Feature type
 */
export type FileProcessorFeature = 'text_extraction' | 'to_markdown'

/**
 * Input type (category)
 * Can be migrated to FileTypes enum in @types later
 */
export type FileProcessorInput = 'image' | 'document'

/**
 * Output type
 */
export type FileProcessorOutput = 'text' | 'markdown'

/**
 * Processor metadata
 */
export type FileProcessorMetadata = {
  maxFileSizeMb?: number
  maxPageCount?: number
}

/**
 * Feature capability definition
 *
 * Each capability binds a feature with its input/output and optional API settings.
 */
export type FeatureCapability = {
  feature: FileProcessorFeature
  input: FileProcessorInput
  output: FileProcessorOutput
  defaultApiHost?: string // Feature-level default API Host
  defaultModelId?: string // Feature-level default Model ID
  // supportedFormats?: string[] // Whitelist: only these formats supported (uncomment when needed)
  // excludedFormats?: string[] // Blacklist: all formats except these (uncomment when needed)
}

/**
 * Processor template (read-only metadata)
 *
 * Note: Display name is retrieved via i18n key `processor.${id}.name`
 */
export type FileProcessorTemplate = {
  id: string // Unique identifier, also used for i18n key
  type: FileProcessorType // 'api' | 'builtin'
  metadata?: FileProcessorMetadata // Optional processor metadata
  capabilities: FeatureCapability[] // Feature capabilities
}

// ============================================================================
// Override Types (for user customization)
// ============================================================================

/**
 * Processor-specific configuration
 *
 * Uses a generic Record type without predefined structure.
 * Each processor's configuration is interpreted by UI components based on processor.id.
 *
 * Known options fields:
 * - Tesseract: { langs: string[] }  // Array of enabled language codes
 *
 * Examples:
 * - { langs: ['chi_sim', 'eng'] }        // Tesseract language config
 * - { quality: 'high', timeout: 30000 }  // Other processor config
 */
export type FileProcessorOptions = Record<string, unknown>

/**
 * Feature-level user configuration
 *
 * Allows per-feature API host and model overrides.
 * This is needed because some processors (e.g., PaddleOCR) have different
 * API endpoints for different features.
 */
export type FeatureUserConfig = {
  feature: FileProcessorFeature
  apiHost?: string // User override for this feature's API Host
  modelId?: string // User override for this feature's Model ID
}

/**
 * User-configured processor override (stored in Preference)
 *
 * Design principles:
 * - Only stores user-modified fields
 * - apiKey is shared across all features (processor-level)
 * - apiHost/modelId are per-feature (in featureConfigs)
 * - Field names use camelCase (consistent with TypeScript conventions)
 */
export type FileProcessorOverride = {
  apiKey?: string // API Key (shared across all features)
  featureConfigs?: FeatureUserConfig[] // Feature-level configurations
  options?: FileProcessorOptions // Processor-specific config (generic type)
}

/**
 * Map of processor id -> overrides
 */
export type FileProcessorOverrides = Record<string, FileProcessorOverride>

/**
 * Merged processor configuration (template + user override)
 *
 * Used by both Renderer (UI display/editing) and Main (execution).
 * Combines the read-only template with user-configured overrides.
 */
export type FileProcessorMerged = FileProcessorTemplate & FileProcessorOverride

// ============================================================================
// Processor Presets
// ============================================================================

/**
 * Built-in processor presets
 */
export const PRESETS_FILE_PROCESSORS: FileProcessorTemplate[] = [
  // === Image Processors (former OCR) ===
  {
    id: 'tesseract',
    type: 'builtin',
    capabilities: [
      {
        feature: 'text_extraction',
        input: 'image',
        output: 'text'
      }
    ]
  },
  {
    id: 'system',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  },
  {
    id: 'paddleocr',
    type: 'api',
    capabilities: [
      {
        feature: 'text_extraction',
        input: 'image',
        output: 'text',
        defaultApiHost: ''
      }
    ]
  },
  {
    id: 'ovocr',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  },

  // === Document Processors (former Preprocess) ===
  {
    id: 'mineru',
    type: 'api',
    metadata: {
      maxFileSizeMb: 200,
      maxPageCount: 600
    },
    capabilities: [
      {
        feature: 'to_markdown',
        input: 'document',
        output: 'markdown',
        defaultApiHost: 'https://mineru.net'
      }
    ]
  },
  {
    id: 'doc2x',
    type: 'api',
    metadata: {
      maxFileSizeMb: 300,
      maxPageCount: 1000
    },
    capabilities: [
      {
        feature: 'to_markdown',
        input: 'document',
        output: 'markdown',
        defaultApiHost: 'https://v2.doc2x.noedgeai.com'
      }
    ]
  },
  {
    id: 'mistral',
    type: 'api',
    metadata: {
      maxFileSizeMb: 50,
      maxPageCount: 1000
    },
    capabilities: [
      {
        feature: 'to_markdown',
        input: 'document',
        output: 'markdown',
        defaultApiHost: 'https://api.mistral.ai',
        defaultModelId: 'mistral-ocr-latest'
      }
    ]
  },
  {
    id: 'open-mineru',
    type: 'api',
    metadata: {
      maxFileSizeMb: 200,
      maxPageCount: 600
    },
    capabilities: [
      {
        feature: 'to_markdown',
        input: 'document',
        output: 'markdown',
        defaultApiHost: 'http://127.0.0.1:8000'
      }
    ]
  }
]
