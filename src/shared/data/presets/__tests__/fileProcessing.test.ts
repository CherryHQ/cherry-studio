import { FILE_TYPE } from '@shared/types/file'
import { GB, MB } from '@shared/utils/constants'
import { describe, expect, it } from 'vitest'

import { FILE_PROCESSOR_IDS } from '../../preference/preferenceTypes'
import {
  FileProcessingArtifactSchema,
  FileProcessingJobOutputSchema,
  FileProcessingOutputTargetSchema,
  ListAvailableFileProcessorsResultSchema
} from '../../types/fileProcessing'
import {
  DocumentToMarkdownCapabilitySchema,
  FileProcessorFeatureCapabilitySchema,
  FileProcessorIdSchema,
  FileProcessorOverrideSchema,
  FileProcessorPresetDefinitionSchema,
  FileProcessorTemplateSchema,
  FileProcessorTemplatesSchema,
  FileProcessorTypeSchema,
  PRESETS_FILE_PROCESSORS
} from '../fileProcessing'

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

  it.each([0, -1, 1.5])('rejects maxInputPages=%s for document_to_markdown capabilities', (maxInputPages) => {
    const result = DocumentToMarkdownCapabilitySchema.safeParse({
      feature: 'document_to_markdown',
      inputs: [FILE_TYPE.DOCUMENT],
      output: 'markdown',
      maxInputPages
    })

    expect(result.success).toBe(false)
  })

  it.each([0, -1, 1.5])('rejects maxInputBytes=%s for document_to_markdown capabilities', (maxInputBytes) => {
    const result = DocumentToMarkdownCapabilitySchema.safeParse({
      feature: 'document_to_markdown',
      inputs: [FILE_TYPE.DOCUMENT],
      output: 'markdown',
      maxInputBytes
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

  it('ships the current PaddleOCR hosted model defaults', () => {
    const paddleocr = PRESETS_FILE_PROCESSORS.find((preset) => preset.id === 'paddleocr')

    expect(paddleocr?.capabilities.find((capability) => capability.feature === 'image_to_text')?.modelId).toBe(
      'PP-OCRv6'
    )
    expect(paddleocr?.capabilities.find((capability) => capability.feature === 'document_to_markdown')?.modelId).toBe(
      'PaddleOCR-VL-1.6'
    )
  })

  it('declares the product PDF page limits for document processors', () => {
    const limits = Object.fromEntries(
      PRESETS_FILE_PROCESSORS.filter((preset) =>
        ['paddleocr', 'mineru', 'doc2x', 'mistral', 'local-document', 'open-mineru'].includes(preset.id)
      ).map((preset) => [
        preset.id,
        preset.capabilities.find((capability) => capability.feature === 'document_to_markdown')?.maxInputPages
      ])
    )

    expect(limits).toEqual({
      paddleocr: 100,
      mineru: 600,
      doc2x: 1000,
      mistral: 1000,
      'local-document': undefined,
      'open-mineru': undefined
    })
  })

  it('declares the document upload byte limits for processors that enforce one', () => {
    const limits = Object.fromEntries(
      PRESETS_FILE_PROCESSORS.filter((preset) =>
        ['paddleocr', 'mineru', 'doc2x', 'mistral', 'local-document', 'open-mineru'].includes(preset.id)
      ).map((preset) => [
        preset.id,
        preset.capabilities.find((capability) => capability.feature === 'document_to_markdown')?.maxInputBytes
      ])
    )

    expect(limits).toEqual({
      paddleocr: 50 * MB,
      mineru: 200 * MB,
      doc2x: GB,
      mistral: undefined,
      'local-document': undefined,
      'open-mineru': 200 * MB
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

  it.each(['maxInputBytes', 'maxInputPages'])('does not allow %s to be overridden', (field) => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        document_to_markdown: {
          [field]: 10
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
