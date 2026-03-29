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
  FileProcessingMarkdownTaskResultSchema,
  FileProcessingMarkdownTaskStartResultSchema
} from '../data/types/fileProcessing'

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

describe('FileProcessingMarkdownTaskStartResultSchema', () => {
  it('requires processorId on task start results', () => {
    expect(() =>
      FileProcessingMarkdownTaskStartResultSchema.parse({
        providerTaskId: 'task-1',
        status: 'processing',
        progress: 0
      })
    ).toThrow()
  })

  it('accepts valid task start results', () => {
    const result = FileProcessingMarkdownTaskStartResultSchema.parse({
      providerTaskId: 'task-1',
      status: 'processing',
      progress: 0,
      processorId: 'mineru'
    })

    expect(result.processorId).toBe('mineru')
  })
})

describe('FileProcessingMarkdownTaskResultSchema', () => {
  it('rejects completed results without markdownPath', () => {
    expect(() =>
      FileProcessingMarkdownTaskResultSchema.parse({
        status: 'completed',
        progress: 100,
        processorId: 'mineru'
      })
    ).toThrow()
  })

  it('rejects failed results without error', () => {
    expect(() =>
      FileProcessingMarkdownTaskResultSchema.parse({
        status: 'failed',
        progress: 0,
        processorId: 'mineru'
      })
    ).toThrow()
  })

  it('rejects processing results with completed-only fields', () => {
    expect(() =>
      FileProcessingMarkdownTaskResultSchema.parse({
        status: 'processing',
        progress: 50,
        processorId: 'mineru',
        markdownPath: '/tmp/output.md'
      })
    ).toThrow()
  })

  it('accepts valid completed results', () => {
    const result = FileProcessingMarkdownTaskResultSchema.parse({
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      markdownPath: '/tmp/output.md'
    })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') {
      throw new Error('Expected completed markdown task result')
    }
    expect(result.markdownPath).toBe('/tmp/output.md')
  })
})
