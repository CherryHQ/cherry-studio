import { describe, expect, it } from 'vitest'

import { FILE_PROCESSOR_IDS } from '../data/preference/preferenceTypes'
import {
  FileProcessorFeatureCapabilitySchema,
  FileProcessorIdSchema,
  FileProcessorOverrideSchema,
  FileProcessorPresetDefinitionSchema,
  FileProcessorTemplateSchema,
  FileProcessorTemplatesSchema,
  FileProcessorTypeSchema,
  PRESETS_FILE_PROCESSORS
} from '../data/presets/file-processing'
import { FILE_TYPE } from '../data/types/file'

describe('FileProcessorFeatureCapabilitySchema', () => {
  it('supports multiple input types for a single capability', () => {
    const result = FileProcessorFeatureCapabilitySchema.safeParse({
      feature: 'text_extraction',
      inputs: [FILE_TYPE.IMAGE, FILE_TYPE.DOCUMENT],
      output: FILE_TYPE.TEXT
    })

    expect(result.success).toBe(true)
  })
})

describe('FileProcessorTemplatesSchema', () => {
  it('validates built-in presets', () => {
    expect(() => FileProcessorTemplatesSchema.parse(PRESETS_FILE_PROCESSORS)).not.toThrow()
    expect(PRESETS_FILE_PROCESSORS.map((preset) => preset.id)).toEqual(FILE_PROCESSOR_IDS)

    PRESETS_FILE_PROCESSORS.forEach((preset) => {
      expect(FileProcessorPresetDefinitionSchema.safeParse(preset).success).toBe(true)
      expect(FileProcessorTypeSchema.safeParse(preset.type).success).toBe(true)
      expect(FileProcessorIdSchema.safeParse(preset.id).success).toBe(true)
    })
  })

  it('rejects processor-level metadata', () => {
    const result = FileProcessorTemplateSchema.safeParse({
      id: 'paddleocr',
      type: 'api',
      metadata: {},
      capabilities: [
        {
          feature: 'text_extraction',
          inputs: [FILE_TYPE.IMAGE],
          output: FILE_TYPE.TEXT
        }
      ]
    })

    expect(result.success).toBe(false)
  })

  it('rejects duplicate features in a single processor template', () => {
    const result = FileProcessorTemplateSchema.safeParse({
      id: 'paddleocr',
      type: 'api',
      capabilities: [
        {
          feature: 'text_extraction',
          inputs: [FILE_TYPE.IMAGE],
          output: FILE_TYPE.TEXT
        },
        {
          feature: 'text_extraction',
          inputs: [FILE_TYPE.DOCUMENT],
          output: FILE_TYPE.TEXT
        }
      ]
    })

    expect(result.success).toBe(false)
  })
})

describe('FileProcessorOverrideSchema', () => {
  it('accepts valid overrides', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      apiKeys: ['test-key'],
      capabilities: {
        text_extraction: {
          apiHost: 'https://example.com',
          modelId: 'model-1'
        }
      },
      options: {
        langs: ['eng', 'chi_sim']
      }
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid urls', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        markdown_conversion: {
          apiHost: 'not-a-url'
        }
      }
    })

    expect(result.success).toBe(false)
  })

  it('rejects unknown feature overrides', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        vision: {
          apiHost: 'https://example.com'
        }
      }
    })

    expect(result.success).toBe(false)
  })

  it('rejects capability metadata overrides', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        markdown_conversion: {
          metadata: {
            optionalPayload: {
              enable_formula: false
            }
          }
        }
      }
    })

    expect(result.success).toBe(false)
  })
})
