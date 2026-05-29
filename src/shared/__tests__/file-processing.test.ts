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
import {
  FileProcessingArtifactSchema,
  FileProcessingJobOutputSchema,
  ListAvailableFileProcessorsResultSchema
} from '../data/types/fileProcessing'

describe('FileProcessorFeatureCapabilitySchema', () => {
  it('accepts image_to_text with image inputs', () => {
    const result = FileProcessorFeatureCapabilitySchema.safeParse({
      feature: 'image_to_text',
      inputs: [FILE_TYPE.IMAGE],
      output: FILE_TYPE.TEXT
    })

    expect(result.success).toBe(true)
  })

  it('rejects document inputs for image_to_text capabilities', () => {
    const result = FileProcessorFeatureCapabilitySchema.safeParse({
      feature: 'image_to_text',
      inputs: [FILE_TYPE.IMAGE, FILE_TYPE.DOCUMENT],
      output: FILE_TYPE.TEXT
    })

    expect(result.success).toBe(false)
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
          feature: 'image_to_text',
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
          feature: 'image_to_text',
          inputs: [FILE_TYPE.IMAGE],
          output: FILE_TYPE.TEXT
        },
        {
          feature: 'image_to_text',
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
        image_to_text: {
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

  it('accepts custom api host strings', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        document_to_markdown: {
          apiHost: 'not-a-url'
        }
      }
    })

    expect(result.success).toBe(true)
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
})

describe('ListAvailableFileProcessorsResultSchema', () => {
  it('accepts known processor ids', () => {
    expect(() =>
      ListAvailableFileProcessorsResultSchema.parse({
        processorIds: ['system', 'ovocr']
      })
    ).not.toThrow()
  })

  it('rejects unknown processor ids', () => {
    const result = ListAvailableFileProcessorsResultSchema.safeParse({
      processorIds: ['missing']
    })

    expect(result.success).toBe(false)
  })
})

describe('FileProcessingArtifactSchema', () => {
  it('accepts text and markdown file artifacts', () => {
    expect(FileProcessingArtifactSchema.parse({ kind: 'text', format: 'plain', text: 'hello' })).toEqual({
      kind: 'text',
      format: 'plain',
      text: 'hello'
    })

    expect(
      FileProcessingArtifactSchema.parse({
        kind: 'file',
        format: 'markdown',
        fileEntryId: '019606a0-0000-7000-8000-000000000601'
      })
    ).toEqual({
      kind: 'file',
      format: 'markdown',
      fileEntryId: '019606a0-0000-7000-8000-000000000601'
    })
  })
})

describe('FileProcessingJobOutputSchema', () => {
  it('accepts a job output artifact', () => {
    expect(
      FileProcessingJobOutputSchema.parse({
        artifact: { kind: 'file', format: 'markdown', fileEntryId: '019606a0-0000-7000-8000-000000000601' }
      })
    ).toEqual({
      artifact: { kind: 'file', format: 'markdown', fileEntryId: '019606a0-0000-7000-8000-000000000601' }
    })
  })

  it('rejects legacy artifact arrays', () => {
    const result = FileProcessingJobOutputSchema.safeParse({
      artifacts: []
    })

    expect(result.success).toBe(false)
  })

  it('rejects legacy task result fields', () => {
    const result = FileProcessingJobOutputSchema.safeParse({
      taskId: 'task-1',
      status: 'completed',
      progress: 100,
      artifact: { kind: 'file', format: 'markdown', fileEntryId: '019606a0-0000-7000-8000-000000000601' }
    })

    expect(result.success).toBe(false)
  })
})
