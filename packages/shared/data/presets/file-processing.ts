import * as z from 'zod'

import { FILE_TYPE, FileTypeSchema } from '../types/file'

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
export const FileProcessorTypeSchema = z.enum(['api', 'builtin'])
export type FileProcessorType = z.infer<typeof FileProcessorTypeSchema>

/**
 * Feature type
 */
export const FileProcessorFeatureSchema = z.enum(['text_extraction', 'markdown_conversion'])
export type FileProcessorFeature = z.infer<typeof FileProcessorFeatureSchema>

/**
 * Input file type schema
 * Reuses the canonical file type definitions shared across the app.
 */
export const FileProcessorInputSchema = FileTypeSchema.extract([FILE_TYPE.IMAGE, FILE_TYPE.DOCUMENT])

const FileProcessorTextOutputSchema = FileTypeSchema.extract([FILE_TYPE.TEXT])

/**
 * Output content format schema
 * `text` reuses the canonical file type, while `markdown` remains a processing-specific format.
 */
export const FileProcessorOutputSchema = z.union([FileProcessorTextOutputSchema, z.literal('markdown')])

/**
 * Processor metadata (reserved for future use)
 */
export const FileProcessorMetadataSchema = z.record(z.string(), z.never())
export type FileProcessorMetadata = z.infer<typeof FileProcessorMetadataSchema>

/**
 * Feature capability definition
 *
 * Each capability binds a feature with its supported inputs, output, and optional API settings.
 */
export const CapabilityMetadataSchema = z.record(z.string(), z.unknown())
export type CapabilityMetadata = z.infer<typeof CapabilityMetadataSchema>

export const TextExtractionCapabilitySchema = z
  .object({
    feature: z.literal('text_extraction'),
    inputs: z.array(FileProcessorInputSchema).min(1),
    output: z.literal('text'),
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional(),
    metadata: CapabilityMetadataSchema.optional()
    // supportedFormats?: string[] // Whitelist: only these formats supported (uncomment when needed)
    // excludedFormats?: string[] // Blacklist: all formats except these (uncomment when needed)
  })
  .strict()
export type TextExtractionCapability = z.infer<typeof TextExtractionCapabilitySchema>

export const MarkdownConversionCapabilitySchema = z
  .object({
    feature: z.literal('markdown_conversion'),
    inputs: z.array(z.literal('document')).min(1),
    output: z.literal('markdown'),
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional(),
    metadata: CapabilityMetadataSchema.optional()
    // supportedFormats?: string[] // Whitelist: only these formats supported (uncomment when needed)
    // excludedFormats?: string[] // Blacklist: all formats except these (uncomment when needed)
  })
  .strict()
export type MarkdownConversionCapability = z.infer<typeof MarkdownConversionCapabilitySchema>

export const FeatureCapabilitySchema = z.discriminatedUnion('feature', [
  TextExtractionCapabilitySchema,
  MarkdownConversionCapabilitySchema
])
export type FeatureCapability = z.infer<typeof FeatureCapabilitySchema>

/**
 * Input type (category)
 * Derived from FeatureCapability to keep definitions in sync.
 */
export type FileProcessorInput = FeatureCapability['inputs'][number]

/**
 * Output type
 * Derived from FeatureCapability to keep definitions in sync.
 */
export type FileProcessorOutput = FeatureCapability['output']

/**
 * Processor template (read-only metadata)
 *
 * Note: Display name is retrieved via i18n key `processor.${id}.name`
 */
export const FileProcessorTemplateSchema = z
  .object({
    id: z.string().min(1),
    type: FileProcessorTypeSchema,
    metadata: FileProcessorMetadataSchema.optional(),
    capabilities: z.array(FeatureCapabilitySchema).min(1)
  })
  .strict()
  .superRefine((template, ctx) => {
    const seenFeatures = new Set<FileProcessorFeature>()

    template.capabilities.forEach((capability, index) => {
      if (seenFeatures.has(capability.feature)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', index, 'feature'],
          message: `Duplicate capability feature '${capability.feature}' is not allowed. Use 'inputs' to model multiple input types.`
        })
        return
      }

      seenFeatures.add(capability.feature)
    })
  })
export type FileProcessorTemplate = z.infer<typeof FileProcessorTemplateSchema>
export const FileProcessorTemplatesSchema = z.array(FileProcessorTemplateSchema)

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
export const FileProcessorOptionsSchema = z.record(z.string(), z.unknown())
export type FileProcessorOptions = z.infer<typeof FileProcessorOptionsSchema>

/**
 * Capability override (user customization for a specific feature)
 *
 * Stored as Record<feature, CapabilityOverride> in FileProcessorOverride.
 */
export const CapabilityOverrideSchema = z
  .object({
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional(),
    metadata: CapabilityMetadataSchema.optional()
  })
  .strict()
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>

export const FileProcessorCapabilityOverridesSchema = z
  .object({
    markdown_conversion: CapabilityOverrideSchema.optional(),
    text_extraction: CapabilityOverrideSchema.optional()
  })
  .strict()

/**
 * User-configured processor override (stored in Preference)
 *
 * Design principles:
 * - Only stores user-modified fields
 * - apiKey is shared across all features (processor-level)
 * - apiHost/modelId are per-feature (in capabilities Record)
 * - Field names use camelCase (consistent with TypeScript conventions)
 */
export const FileProcessorOverrideSchema = z
  .object({
    apiKeys: z.array(z.string().min(1)).optional(),
    capabilities: FileProcessorCapabilityOverridesSchema.optional(),
    options: FileProcessorOptionsSchema.optional()
  })
  .strict()
export type FileProcessorOverride = z.infer<typeof FileProcessorOverrideSchema>
export const FileProcessorOverridesSchema = z.record(z.string(), FileProcessorOverrideSchema)

/**
 * Merged processor configuration (template + user override)
 *
 * Used by both Renderer (UI display/editing) and Main (execution).
 * Combines the read-only template with user-configured overrides.
 *
 * Note: capabilities is an array (from template) with overrides merged in,
 * NOT a Record like in FileProcessorOverride.
 */
export const FileProcessorMergedSchema = FileProcessorTemplateSchema.extend({
  apiKeys: z.array(z.string().min(1)).optional(),
  options: FileProcessorOptionsSchema.optional()
})
export type FileProcessorMerged = z.infer<typeof FileProcessorMergedSchema>

// ============================================================================
// Processor Presets
// ============================================================================

/**
 * Built-in processor presets
 */
export const PRESETS_FILE_PROCESSORS = [
  // === Image Processors (former OCR) ===
  {
    id: 'tesseract',
    type: 'builtin',
    capabilities: [
      {
        feature: 'text_extraction',
        inputs: ['image'],
        output: 'text'
      }
    ]
  },
  {
    id: 'system',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', inputs: ['image'], output: 'text' }]
  },
  {
    id: 'paddleocr',
    type: 'api',
    capabilities: [
      {
        feature: 'text_extraction',
        inputs: ['image'],
        output: 'text',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId: 'PP-OCRv5',
        metadata: {
          optionalPayload: {
            useDocOrientationClassify: false,
            useDocUnwarping: false
          }
        }
      },
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId: 'PaddleOCR-VL-1.5',
        metadata: {
          optionalPayload: {
            useDocOrientationClassify: false,
            useDocUnwarping: false
          }
        }
      }
    ]
  },
  {
    id: 'ovocr',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', inputs: ['image'], output: 'text' }]
  },

  // === Document Processors (former Preprocess) ===
  {
    id: 'mineru',
    type: 'api',
    capabilities: [
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://mineru.net',
        metadata: {
          optionalPayload: {
            enable_formula: true,
            enable_table: true,
            is_ocr: true
          }
        }
      }
    ]
  },
  {
    id: 'doc2x',
    type: 'api',
    capabilities: [
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://v2.doc2x.noedgeai.com'
      }
    ]
  },
  {
    id: 'mistral',
    type: 'api',
    capabilities: [
      {
        feature: 'text_extraction',
        inputs: ['image'],
        output: 'text',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      },
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      }
    ]
  },
  {
    id: 'open-mineru',
    type: 'api',
    capabilities: [
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'http://127.0.0.1:8000'
      }
    ]
  }
] as const satisfies readonly FileProcessorTemplate[]

void FileProcessorTemplatesSchema.parse(PRESETS_FILE_PROCESSORS)
