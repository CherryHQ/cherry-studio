import { resolve } from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveImageGenerationSupport } from '@cherrystudio/provider-registry'
import { readModelRegistry, readProviderModelRegistry } from '@cherrystudio/provider-registry/node'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { Assistant } from '@shared/data/types/assistant'
import type { ImageGenerationSupport } from '@shared/data/types/model'

import type { ToolApplyScope } from '../../types'

const { getPreference, getModelByKey, getImageGenerationSupport, generateImage, fileRead } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  getModelByKey: vi.fn(),
  getImageGenerationSupport: vi.fn(),
  generateImage: vi.fn(),
  fileRead: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: getModelByKey }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { getImageGenerationSupport }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory({
    PreferenceService: { get: getPreference },
    FileManager: { read: fileRead }
  })
  const getInfrastructure = mock.application.get.getMockImplementation()!
  mock.application.get.mockImplementation((name) =>
    name === 'AiService' ? { generateImage } : getInfrastructure(name)
  )
  return mock
})

import {
  generateImageFromPrompt,
  PAINTING_ERROR_NOTE,
  PAINTING_GENERATE_NOT_SUPPORTED_NOTE,
  PAINTING_INVALID_REQUEST_NOTE,
  PAINTING_MODEL_NOT_CONFIGURED_NOTE
} from '../../../../painting'
import { createGenerateImageToolEntry } from '../PaintingTool'

const entry = createGenerateImageToolEntry()

function makeOptions(abortSignal = new AbortController().signal): ToolExecutionOptions {
  return {
    toolCallId: 't1',
    messages: [],
    experimental_context: { requestId: 'r1', abortSignal }
  }
}

function callExecute(
  args: { prompt: string; image_ids?: string[]; [key: string]: unknown },
  abortSignal?: AbortSignal,
  selectedTool: Tool = entry.tool
): Promise<unknown> {
  const execute = selectedTool.execute as (
    args: { prompt: string; image_ids?: string[]; [key: string]: unknown },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

const generateSupport = {
  supports: {
    size: {
      type: 'enum',
      options: ['1024x1024', '1792x1024']
    },
    numImages: {
      type: 'range',
      min: 1,
      max: 3
    }
  },
  inputs: {
    images: {
      min: 0,
      max: {
        kind: 'unknown'
      }
    },
    prompt: 'required',
    mask: 'unknown',
    mediaTypes: {
      kind: 'unknown'
    }
  }
} satisfies ImageGenerationSupport

const editableSupport = {
  supports: {
    quality: {
      type: 'enum',
      options: ['low', 'high']
    }
  },
  inputs: {
    images: {
      min: 0,
      max: {
        kind: 'unknown'
      }
    },
    prompt: 'required',
    mask: 'unknown',
    mediaTypes: {
      kind: 'unknown'
    }
  }
} satisfies ImageGenerationSupport

function buildTool(support: ImageGenerationSupport): Tool {
  return entry.buildTool!({
    mcpToolIds: new Set(),
    paintingModel: { uniqueModelId: 'openai::gpt-image-1', support }
  })
}

function getRegistrySupport(providerId: string, modelId: string): ImageGenerationSupport {
  const registry = readProviderModelRegistry(
    resolve(process.cwd(), 'packages/provider-registry/data/provider-models.json')
  )
  const override = registry.overrides.find((entry) => entry.providerId === providerId && entry.modelId === modelId)
  if (!override) throw new Error('Missing provider-model registry fixture')
  const models = readModelRegistry(resolve(process.cwd(), 'packages/provider-registry/data/models.json'))
  const base = models.models.find((model) => model.id === modelId)
  const support = resolveImageGenerationSupport(base ?? null, override)
  if (!support) throw new Error('Missing imageGeneration registry fixture')
  return support
}

describe('generate_image', () => {
  beforeEach(() => {
    getPreference.mockReset()
    getModelByKey.mockReset()
    getImageGenerationSupport.mockReset()
    generateImage.mockReset()
    fileRead.mockReset()
    getModelByKey.mockReturnValue({})
    getImageGenerationSupport.mockReturnValue(null)
  })

  describe('applies', () => {
    const scopeWith = (enableGenerateImage?: boolean, hasPaintingModel = true): ToolApplyScope => ({
      mcpToolIds: new Set(),
      paintingModel: hasPaintingModel ? { uniqueModelId: 'openai::dall-e-3', support: generateSupport } : undefined,
      assistant: enableGenerateImage === undefined ? undefined : ({ settings: { enableGenerateImage } } as Assistant)
    })

    it('returns false when no painting model is configured', () => {
      expect(entry.applies!(scopeWith(true, false))).toBe(false)
    })

    it('returns false when the assistant toggle is off (or absent)', () => {
      expect(entry.applies!(scopeWith(false))).toBe(false)
      expect(entry.applies!(scopeWith(undefined))).toBe(false)
    })

    it('returns true when a painting model is configured and the assistant toggle is on', () => {
      expect(entry.applies!(scopeWith(true))).toBe(true)
    })
  })

  it('resolves the painting model and returns the generated file items', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockResolvedValue({ files: [{ id: 'f1', name: 'image-1.png' }] })

    const result = await callExecute({ prompt: 'a cat' })

    expect(result).toEqual([{ id: 'f1', name: 'image-1.png' }])
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueModelId: 'openai::dall-e-3', prompt: 'a cat', paramValues: {} })
    )
  })

  it.each([
    { size: 'custom', customSize: '1536x1024' },
    { customSize: '1536x1024' },
    { size: '1536x1024' },
    { size: '1536x1024', customSize: '1536x1024' }
  ])('normalizes a real Zhipu custom size before authoritative validation: %j', async (params) => {
    generateImage.mockResolvedValue({ files: [{ id: 'landscape', name: 'landscape.png' }] })

    const result = await callExecute(
      { prompt: 'a wide landscape', ...params },
      undefined,
      buildTool(getRegistrySupport('zhipu', 'cogview-4'))
    )

    expect(result).toEqual([{ id: 'landscape', name: 'landscape.png' }])
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ paramValues: { size: '1536x1024' } }))
  })

  it.each([
    { size: 'custom' },
    { size: 'custom', customSize: '511x1024' },
    { size: '1024x1024', customSize: '1536x1024' }
  ])('rejects incomplete, out-of-bounds and conflicting custom dimensions before generation: %j', async (params) => {
    const support = getRegistrySupport('zhipu', 'cogview-4')
    const result = await generateImageFromPrompt({ prompt: 'a fox', image_ids: ['reference'], ...params }, undefined, {
      uniqueModelId: 'zhipu::cogview-4',
      support
    })
    expect(result).toEqual({ error: PAINTING_INVALID_REQUEST_NOTE })
    expect(generateImage).not.toHaveBeenCalled()
    expect(fileRead).not.toHaveBeenCalled()
  })

  it('resolves edit image ids to base64 data URLs and keeps ordinary generation', async () => {
    fileRead.mockResolvedValue({ content: 'AAAA', mime: 'image/png' })
    generateImage.mockResolvedValue({ files: [] })

    await callExecute(
      { prompt: 'make it blue', image_ids: ['f1'], quality: 'high' },
      undefined,
      buildTool(editableSupport)
    )

    expect(fileRead).toHaveBeenCalledWith('f1', { encoding: 'base64' })
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'generate',
        inputImages: ['data:image/png;base64,AAAA'],
        paramValues: { quality: 'high' }
      })
    )
  })

  it('preserves all TokenHub references without requiring an edit declaration', async () => {
    const support = getRegistrySupport('tokenhub', 'hy-image-v3-0')
    const selectedTool = entry.buildTool!({
      mcpToolIds: new Set(),
      paintingModel: { uniqueModelId: 'tokenhub::hy-image-v3', support }
    })
    fileRead.mockImplementation(async (id: string) => ({
      content: Buffer.from(id).toString('base64'),
      mime: 'image/png'
    }))
    generateImage.mockResolvedValue({ files: [{ id: 'result', name: 'fox.png' }] })
    const result = await callExecute({ prompt: 'a fox', image_ids: ['a', 'b', 'c'] }, undefined, selectedTool)
    expect(result).toEqual([{ id: 'result', name: 'fox.png' }])
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'generate',
        inputImages: ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==', 'data:image/png;base64,Yw==']
      })
    )
  })

  it('rejects invalid explicit parameters before reading references or generating', async () => {
    const result = await generateImageFromPrompt(
      { prompt: 'a fox', image_ids: ['a'], quality: 'unsupported' },
      undefined,
      { uniqueModelId: 'openai::gpt-image-1', support: editableSupport }
    )
    expect(result).toEqual({ error: PAINTING_INVALID_REQUEST_NOTE })
    expect(fileRead).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('returns a permanent note when the configured model does not support ordinary generation', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    getImageGenerationSupport.mockReturnValue({
      supports: {},
      inputs: {
        images: {
          min: 0,
          max: {
            kind: 'unknown'
          }
        },
        prompt: 'required',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      },
      operations: {
        generate: null,
        upscale: {
          supports: {},
          inputs: {
            images: {
              min: 1,
              max: {
                kind: 'unknown'
              }
            },
            prompt: 'required'
          }
        }
      }
    })

    const result = await generateImageFromPrompt({ prompt: 'edit it', image_ids: ['f1'] })

    expect(result).toEqual({ error: PAINTING_GENERATE_NOT_SUPPORTED_NOTE })
    expect(fileRead).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('returns a configuration note (and skips generation) when no model is configured', async () => {
    getPreference.mockReturnValue(null)

    const result = (await callExecute({ prompt: 'a cat' })) as { error: string }

    expect(result).toEqual({ error: PAINTING_MODEL_NOT_CONFIGURED_NOTE })
    expect(result.error).toContain('No painting model is configured')
    expect(result.error).toContain('do not retry')
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('treats a model unavailable in the current edition as not configured', async () => {
    getPreference.mockReturnValue('global-only::image-model')
    getModelByKey.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Model', 'global-only::image-model')
    })

    const result = await callExecute({ prompt: 'a cat' })

    expect(result).toEqual({ error: PAINTING_MODEL_NOT_CONFIGURED_NOTE })
    expect(getImageGenerationSupport).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('returns an error discriminant when generation fails', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockRejectedValue(new Error('boom'))

    const result = await callExecute({ prompt: 'a cat' })

    expect(result).toEqual({ error: PAINTING_ERROR_NOTE })
  })

  it('rethrows an abort instead of converting it to an error discriminant', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    generateImage.mockRejectedValue(abortError)

    await expect(callExecute({ prompt: 'a cat' })).rejects.toBe(abortError)
  })

  describe('toModelOutput', () => {
    it('summarizes a successful file array', () => {
      const toModelOutput = entry.tool.toModelOutput!
      const view = toModelOutput({ output: [{ id: 'f1', name: 'image-1.png' }] } as never) as unknown as {
        type: string
        value: string
      }
      expect(view.type).toBe('text')
      expect(view.value).toContain('Generated 1 image(s)')
      expect(view.value).toContain('image-1.png')
    })

    it('surfaces the error note on the error path', () => {
      const toModelOutput = entry.tool.toModelOutput!
      expect(toModelOutput({ output: { error: 'x' } } as never)).toEqual({ type: 'text', value: 'x' })
    })
  })
})
