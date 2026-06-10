import { describe, expect, it } from 'vitest'

import { FILE_PROCESSOR_IDS } from '../../preference/preferenceTypes'
import { FILE_TYPE } from '../../types/file'
import {
  FileProcessingArtifactSchema,
  FileProcessingJobOutputSchema,
  FileProcessingOutputTargetSchema,
  ListAvailableFileProcessorsResultSchema
} from '../../types/fileProcessing'
import {
  FileProcessorFeatureCapabilitySchema,
  FileProcessorIdSchema,
  FileProcessorOverrideSchema,
  FileProcessorPresetDefinitionSchema,
  FileProcessorTemplateSchema,
  FileProcessorTemplatesSchema,
  FileProcessorTypeSchema,
  PRESETS_FILE_PROCESSORS
} from '../file-processing'

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
        path: '/tmp/out.md'
      })
    ).toEqual({
      kind: 'file',
      format: 'markdown',
      path: '/tmp/out.md'
    })
  })
})

describe('FileProcessingJobOutputSchema', () => {
  it('accepts a job output artifact', () => {
    expect(
      FileProcessingJobOutputSchema.parse({
        artifact: { kind: 'file', format: 'markdown', path: '/tmp/out.md' }
      })
    ).toEqual({
      artifact: { kind: 'file', format: 'markdown', path: '/tmp/out.md' }
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
      artifact: { kind: 'file', format: 'markdown', path: '/tmp/out.md' }
    })

    expect(result.success).toBe(false)
  })
})

describe('FileProcessingOutputTargetSchema', () => {
  it('accepts absolute posix and windows paths', () => {
    expect(FileProcessingOutputTargetSchema.parse({ kind: 'path', path: '/tmp/out.md' })).toEqual({
      kind: 'path',
      path: '/tmp/out.md'
    })

    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path', path: 'C:\\tmp\\out.md' }).success).toBe(true)
  })

  it('rejects relative, empty, and null-byte paths', () => {
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path', path: './out.md' }).success).toBe(false)
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path', path: '' }).success).toBe(false)
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path', path: '/tmp/o\0ut.md' }).success).toBe(false)
  })

  it('rejects a missing path', () => {
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path' }).success).toBe(false)
  })

  it('rejects a wrong kind discriminant', () => {
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'text', path: '/tmp/out.md' }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(FileProcessingOutputTargetSchema.safeParse({ kind: 'path', path: '/tmp/out.md', extra: true }).success).toBe(
      false
    )
  })
})
