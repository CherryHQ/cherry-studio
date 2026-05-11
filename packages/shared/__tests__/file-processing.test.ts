import { describe, expect, it } from 'vitest'

import { FILE_PROCESSOR_IDS } from '../data/preference/preferenceTypes'
import {
  FileProcessorFeatureCapabilitySchema,
  FileProcessorIdSchema,
  FileProcessorOverrideSchema,
  FileProcessorPresetDefinitionSchema,
  fileProcessorSupportsFeature,
  FileProcessorTemplateSchema,
  FileProcessorTemplatesSchema,
  FileProcessorTypeSchema,
  getFileProcessorPresetById,
  PRESETS_FILE_PROCESSORS
} from '../data/presets/file-processing'
import { FILE_TYPE } from '../data/types/file'
import {
  FileProcessingArtifactSchema,
  FileProcessingTaskResultSchema,
  FileProcessingTaskStartResultSchema,
  ListAvailableFileProcessorsResultSchema
} from '../data/types/fileProcessing'
import { mergeFileProcessorPreset } from '../data/utils/fileProcessorMerger'

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

  it('rejects invalid urls', () => {
    const result = FileProcessorOverrideSchema.safeParse({
      capabilities: {
        document_to_markdown: {
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
})

describe('file processor preset lookup', () => {
  it('looks up presets by id and checks feature support', () => {
    expect(getFileProcessorPresetById('paddleocr')?.id).toBe('paddleocr')
    expect(fileProcessorSupportsFeature('paddleocr', 'image_to_text')).toBe(true)
    expect(fileProcessorSupportsFeature('doc2x', 'image_to_text')).toBe(false)
  })
})

describe('mergeFileProcessorPreset', () => {
  it('returns preset capabilities unchanged when override is missing', () => {
    const preset = getFileProcessorPresetById('tesseract')

    expect(preset).toBeDefined()
    expect(mergeFileProcessorPreset(preset!)).toEqual({
      id: 'tesseract',
      type: 'builtin',
      capabilities: [
        {
          feature: 'image_to_text',
          inputs: ['image'],
          output: 'text'
        }
      ],
      apiKeys: undefined,
      options: undefined
    })
  })

  it('merges processor-level apiKeys and options from override', () => {
    const preset = getFileProcessorPresetById('doc2x')

    expect(preset).toBeDefined()
    expect(
      mergeFileProcessorPreset(preset!, {
        apiKeys: ['key-1', 'key-2'],
        options: {
          mode: 'fast'
        }
      })
    ).toEqual({
      id: 'doc2x',
      type: 'api',
      capabilities: [
        {
          feature: 'document_to_markdown',
          inputs: ['document'],
          output: 'markdown',
          apiHost: 'https://v2.doc2x.noedgeai.com',
          modelId: 'v3-2026'
        }
      ],
      apiKeys: ['key-1', 'key-2'],
      options: {
        mode: 'fast'
      }
    })
  })

  it('merges capability override only into the targeted feature', () => {
    const preset = getFileProcessorPresetById('paddleocr')

    expect(preset).toBeDefined()

    const merged = mergeFileProcessorPreset(preset!, {
      capabilities: {
        document_to_markdown: {
          apiHost: 'https://custom.example.com',
          modelId: 'custom-model'
        }
      }
    })

    expect(merged.capabilities).toEqual([
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
        apiHost: 'https://custom.example.com',
        modelId: 'custom-model'
      }
    ])
  })
})

describe('FileProcessingTaskStartResultSchema', () => {
  it('requires taskId and feature on task start results', () => {
    expect(() =>
      FileProcessingTaskStartResultSchema.parse({
        status: 'processing',
        progress: 0,
        processorId: 'mineru'
      })
    ).toThrow()
  })

  it('accepts valid task start results', () => {
    const result = FileProcessingTaskStartResultSchema.parse({
      taskId: 'task-1',
      feature: 'document_to_markdown',
      status: 'processing',
      progress: 0,
      processorId: 'mineru'
    })

    expect(result.taskId).toBe('task-1')
    expect(result.processorId).toBe('mineru')
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

    expect(FileProcessingArtifactSchema.parse({ kind: 'file', format: 'markdown', path: '/tmp/output.md' })).toEqual({
      kind: 'file',
      format: 'markdown',
      path: '/tmp/output.md'
    })
  })
})

describe('FileProcessingTaskResultSchema', () => {
  it('rejects completed results without artifacts', () => {
    expect(() =>
      FileProcessingTaskResultSchema.parse({
        taskId: 'task-1',
        feature: 'document_to_markdown',
        status: 'completed',
        progress: 100,
        processorId: 'mineru'
      })
    ).toThrow()
  })

  it('rejects failed results without error', () => {
    expect(() =>
      FileProcessingTaskResultSchema.parse({
        taskId: 'task-1',
        feature: 'document_to_markdown',
        status: 'failed',
        progress: 0,
        processorId: 'mineru'
      })
    ).toThrow()
  })

  it('rejects processing results with completed-only fields', () => {
    expect(() =>
      FileProcessingTaskResultSchema.parse({
        taskId: 'task-1',
        feature: 'document_to_markdown',
        status: 'processing',
        progress: 50,
        processorId: 'mineru',
        artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/output.md' }]
      })
    ).toThrow()
  })

  it('accepts valid completed and cancelled results', () => {
    const completed = FileProcessingTaskResultSchema.parse({
      taskId: 'task-1',
      feature: 'document_to_markdown',
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/output.md' }]
    })

    expect(completed.status).toBe('completed')

    const cancelled = FileProcessingTaskResultSchema.parse({
      taskId: 'task-2',
      feature: 'image_to_text',
      status: 'cancelled',
      progress: 10,
      processorId: 'tesseract',
      reason: 'cancelled'
    })

    expect(cancelled.status).toBe('cancelled')
  })
})
