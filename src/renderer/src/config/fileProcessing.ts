/**
 * File Processing Configuration
 *
 * This file contains template definitions for file processors.
 * User configurations (apiKey, featureConfigs, etc.) are stored in Preference system.
 *
 * Design: Template + User Config separation
 * - Templates (this file): Read-only metadata about processors
 * - User Config (Preference): User-modified fields only
 *
 * i18n: Processor names are retrieved via `processor.${id}.name` key
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
 */
export type FileProcessorInput = 'image' | 'document'

/**
 * Output type
 */
export type FileProcessorOutput = 'text' | 'markdown'

/**
 * Feature capability definition
 *
 * Each capability binds a feature with its input/output and optional API settings.
 * Format filtering rules:
 * - Neither specified: supports all formats in the input category
 * - supportedFormats specified: only supports listed formats (whitelist)
 * - excludedFormats specified: supports all except listed formats (blacklist)
 */
export type FeatureCapability = {
  feature: FileProcessorFeature
  input: FileProcessorInput
  supportedFormats?: string[] // Whitelist: only these formats supported
  excludedFormats?: string[] // Blacklist: all formats except these
  output: FileProcessorOutput
  defaultApiHost?: string // Feature-level default API Host
  defaultModelId?: string // Feature-level default Model ID
}

/**
 * Processor template (read-only metadata)
 *
 * Note: Display name is retrieved via i18n key `processor.${id}.name`
 */
export type FileProcessorTemplate = {
  id: string // Unique identifier, also used for i18n key
  type: FileProcessorType // 'api' | 'builtin'
  capabilities: FeatureCapability[] // Feature capabilities
}

// ============================================================================
// Processor Templates
// ============================================================================

/**
 * Built-in processor templates
 */
export const FILE_PROCESSOR_TEMPLATES: FileProcessorTemplate[] = [
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get processor template by ID
 */
export function getFileProcessorTemplate(id: string): FileProcessorTemplate | undefined {
  return FILE_PROCESSOR_TEMPLATES.find((t) => t.id === id)
}

/**
 * Get all image processors (have capability with input='image')
 */
export function getImageProcessorTemplates(): FileProcessorTemplate[] {
  return FILE_PROCESSOR_TEMPLATES.filter((t) => t.capabilities.some((c) => c.input === 'image'))
}

/**
 * Get all document processors (have capability with input='document')
 */
export function getDocumentProcessorTemplates(): FileProcessorTemplate[] {
  return FILE_PROCESSOR_TEMPLATES.filter((t) => t.capabilities.some((c) => c.input === 'document'))
}

/**
 * Check if processor supports a specific input type
 */
export function supportsInput(processor: FileProcessorTemplate, input: FileProcessorInput): boolean {
  return processor.capabilities.some((c) => c.input === input)
}

/**
 * Check if processor supports a specific feature
 */
export function supportsFeature(processor: FileProcessorTemplate, feature: FileProcessorFeature): boolean {
  return processor.capabilities.some((c) => c.feature === feature)
}

/**
 * Check if processor supports a specific file format
 */
export function supportsFormat(processor: FileProcessorTemplate, format: string, input: FileProcessorInput): boolean {
  const capabilities = processor.capabilities.filter((c) => c.input === input)
  if (capabilities.length === 0) return false

  return capabilities.some((c) => {
    // If supportedFormats specified, check whitelist
    if (c.supportedFormats) {
      return c.supportedFormats.includes(format)
    }
    // If excludedFormats specified, check blacklist
    if (c.excludedFormats) {
      return !c.excludedFormats.includes(format)
    }
    // Neither specified, all formats supported
    return true
  })
}

/**
 * Get capability for a specific feature and input combination
 */
export function getCapability(
  processor: FileProcessorTemplate,
  feature: FileProcessorFeature,
  input: FileProcessorInput
): FeatureCapability | undefined {
  return processor.capabilities.find((c) => c.feature === feature && c.input === input)
}
