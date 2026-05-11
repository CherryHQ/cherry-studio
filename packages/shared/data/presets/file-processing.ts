import * as z from 'zod'

import {
  FILE_PROCESSOR_FEATURES,
  FILE_PROCESSOR_IDS,
  FILE_PROCESSOR_TYPES,
  type FileProcessorCapabilityOverride,
  type FileProcessorCapabilityOverrides,
  type FileProcessorFeature,
  type FileProcessorId,
  type FileProcessorOptions,
  type FileProcessorOverride,
  type FileProcessorOverrides,
  type FileProcessorType
} from '../preference/preferenceTypes'

export const FileProcessorTypeSchema = z.enum(FILE_PROCESSOR_TYPES)

export const FileProcessorFeatureSchema = z.enum(FILE_PROCESSOR_FEATURES)

export const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)

/**
 * Feature capability definition
 *
 * Each capability binds a feature with its supported inputs, output, and optional API settings.
 */

export const ImageToTextCapabilitySchema = z
  .object({
    feature: z.literal('image_to_text'),
    inputs: z.array(z.literal('image')).min(1),
    output: z.literal('text'),
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional()
  })
  .strict()
export type ImageToTextCapability = z.infer<typeof ImageToTextCapabilitySchema>

export const DocumentToMarkdownCapabilitySchema = z
  .object({
    feature: z.literal('document_to_markdown'),
    inputs: z.array(z.literal('document')).min(1),
    output: z.literal('markdown'),
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional()
  })
  .strict()
export type DocumentToMarkdownCapability = z.infer<typeof DocumentToMarkdownCapabilitySchema>

export const FileProcessorFeatureCapabilitySchema = z.discriminatedUnion('feature', [
  ImageToTextCapabilitySchema,
  DocumentToMarkdownCapabilitySchema
])
export type FileProcessorFeatureCapability = z.infer<typeof FileProcessorFeatureCapabilitySchema>

/**
 * Input type (category)
 * Derived from FeatureCapability to keep definitions in sync.
 */
export type FileProcessorInput = FileProcessorFeatureCapability['inputs'][number]

/**
 * Output type
 * Derived from FeatureCapability to keep definitions in sync.
 */
export type FileProcessorOutput = FileProcessorFeatureCapability['output']

/**
 * Processor template (read-only metadata)
 *
 * Note: Display name is retrieved via i18n key `processor.${id}.name`
 */
export const FileProcessorPresetDefinitionSchema = z.object({
  id: FileProcessorIdSchema,
  type: FileProcessorTypeSchema,
  capabilities: z.array(FileProcessorFeatureCapabilitySchema).min(1)
})

export const FileProcessorTemplateSchema = FileProcessorPresetDefinitionSchema.strict().superRefine((template, ctx) => {
  const seenFeatures = new Set<FileProcessorFeature>()

  template.capabilities.forEach((capability, index) => {
    if (seenFeatures.has(capability.feature)) {
      ctx.addIssue({
        code: 'custom',
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

type FileProcessorPresetConfig = {
  type: FileProcessorType
  capabilities: readonly FileProcessorFeatureCapability[]
}

export interface FileProcessorPreset extends FileProcessorPresetConfig {
  id: FileProcessorId
}

/**
 * Processor-specific user override options.
 * Currently used by system OCR and Tesseract for enabled language codes.
 */
export const FileProcessorOptionsSchema: z.ZodType<FileProcessorOptions> = z
  .object({
    langs: z.array(z.string()).optional()
  })
  .strict()

/**
 * Capability override (user customization for a specific feature)
 *
 * Stored as Record<feature, FileProcessorCapabilityOverride> in FileProcessorOverride.
 */
export const FileProcessorCapabilityOverrideSchema: z.ZodType<FileProcessorCapabilityOverride> = z
  .object({
    apiHost: z.url().optional(),
    modelId: z.string().min(1).optional()
  })
  .strict()

export const FileProcessorCapabilityOverridesSchema: z.ZodType<FileProcessorCapabilityOverrides> = z
  .object({
    document_to_markdown: FileProcessorCapabilityOverrideSchema.optional(),
    image_to_text: FileProcessorCapabilityOverrideSchema.optional()
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
export const FileProcessorOverrideSchema: z.ZodType<FileProcessorOverride> = z
  .object({
    apiKeys: z.array(z.string().min(1)).optional(),
    capabilities: FileProcessorCapabilityOverridesSchema.optional(),
    options: FileProcessorOptionsSchema.optional()
  })
  .strict()
export const FileProcessorOverridesSchema: z.ZodType<FileProcessorOverrides> = z.partialRecord(
  FileProcessorIdSchema,
  FileProcessorOverrideSchema
)

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

export const FILE_PROCESSOR_PRESET_MAP = {
  tesseract: {
    type: 'builtin',
    capabilities: [
      {
        feature: 'image_to_text',
        inputs: ['image'],
        output: 'text'
      }
    ]
  },
  system: {
    type: 'builtin',
    capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }]
  },
  paddleocr: {
    type: 'api',
    capabilities: [
      {
        feature: 'image_to_text',
        inputs: ['image'],
        output: 'text',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId: 'PaddleOCR-VL-1.5'
      },
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId: 'PaddleOCR-VL-1.5'
      }
    ]
  },
  ovocr: {
    type: 'builtin',
    capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }]
  },

  mineru: {
    type: 'api',
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://mineru.net',
        modelId: 'pipeline'
      }
    ]
  },
  doc2x: {
    type: 'api',
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://v2.doc2x.noedgeai.com',
        modelId: 'v3-2026'
      }
    ]
  },
  mistral: {
    type: 'api',
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      },
      {
        feature: 'image_to_text',
        inputs: ['image'],
        output: 'text',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      }
    ]
  },
  'open-mineru': {
    type: 'api',
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'http://127.0.0.1:8000'
      }
    ]
  }
} as const satisfies Record<FileProcessorId, FileProcessorPresetConfig>

export const PRESETS_FILE_PROCESSORS: readonly FileProcessorPreset[] = FILE_PROCESSOR_IDS.map((id) => ({
  id,
  ...FILE_PROCESSOR_PRESET_MAP[id]
}))
