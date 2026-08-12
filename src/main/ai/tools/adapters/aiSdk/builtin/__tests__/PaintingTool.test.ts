import { resolve } from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { readProviderModelRegistry } from '@cherrystudio/provider-registry/node'
import type { Assistant } from '@shared/data/types/assistant'
import type { ImageGenerationSupport } from '@shared/data/types/model'
import type { Tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolApplyScope } from '../../types'

const { getPreference, getImageGenerationSupport, generateImage, fileRead } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  getImageGenerationSupport: vi.fn(),
  generateImage: vi.fn(),
  fileRead: vi.fn()
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { getImageGenerationSupport }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return { get: getPreference }
      if (name === 'AiService') return { generateImage }
      if (name === 'FileManager') return { read: fileRead }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import {
  generateImageFromPrompt,
  PAINTING_EDIT_NOT_SUPPORTED_NOTE,
  PAINTING_ERROR_NOTE,
  PAINTING_MODEL_NOT_CONFIGURED_NOTE
} from '../../../../painting'
import { createGenerateImageToolEntry, GENERATE_IMAGE_TOOL_NAME } from '../PaintingTool'

const entry = createGenerateImageToolEntry()

function makeOptions(abortSignal = new AbortController().signal): ToolExecutionOptions {
  return {
    toolCallId: 't1',
    messages: [],
    experimental_context: { requestId: 'r1', abortSignal }
  } as ToolExecutionOptions
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
  modes: {
    generate: {
      supports: {
        size: { type: 'enum', options: ['1024x1024', '1792x1024'] },
        numImages: { type: 'range', min: 1, max: 3 }
      }
    }
  }
} satisfies ImageGenerationSupport

const editableSupport = {
  modes: {
    generate: { supports: { size: { type: 'enum', options: ['1024x1024'] } } },
    edit: { supports: { quality: { type: 'enum', options: ['low', 'high'] } } }
  }
} satisfies ImageGenerationSupport

function buildTool(support: ImageGenerationSupport): Tool {
  return entry.buildTool!({
    mcpToolIds: new Set(),
    paintingModel: { uniqueModelId: 'openai::gpt-image-1', support }
  })
}

function getZhipuCogViewSupport(): ImageGenerationSupport {
  const registry = readProviderModelRegistry(
    resolve(process.cwd(), 'packages/provider-registry/data/provider-models.json')
  )
  const support = registry.overrides.find(
    ({ providerId, modelId }) => providerId === 'zhipu' && modelId === 'cogview-4'
  )?.imageGeneration
  if (!support) throw new Error('Missing zhipu/cogview-4 imageGeneration registry fixture')
  return support
}

describe('generate_image', () => {
  beforeEach(() => {
    getPreference.mockReset()
    getImageGenerationSupport.mockReset()
    generateImage.mockReset()
    fileRead.mockReset()
    getImageGenerationSupport.mockReturnValue(null)
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(GENERATE_IMAGE_TOOL_NAME)
    expect(entry.namespace).toBe('media')
    expect(entry.defer).toBe('auto')
    expect(entry.tool.type).toBe('dynamic')
  })

  it('materializes the configured schema as an AI SDK dynamic tool', () => {
    const selectedTool = buildTool(generateSupport)

    expect(selectedTool.type).toBe('dynamic')
    expect(selectedTool.inputSchema).toBeDefined()
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

  it('maps dynamic model params into the canonical parameter bag', async () => {
    generateImage.mockResolvedValue({ files: [] })

    await callExecute({ prompt: 'a cat', size: '1792x1024', numImages: 2 }, undefined, buildTool(generateSupport))

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ paramValues: { size: '1792x1024', numImages: 2 } })
    )
  })

  it('normalizes a real Zhipu customSize input to the native size parameter', async () => {
    generateImage.mockResolvedValue({ files: [] })

    await callExecute(
      { prompt: 'a wide landscape', size: '1024x1024', customSize: '1536x1024' },
      undefined,
      buildTool(getZhipuCogViewSupport())
    )

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ paramValues: { size: '1536x1024' } }))
  })

  it('resolves edit image ids to base64 data URLs and selects edit mode', async () => {
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
        mode: 'edit',
        inputImages: ['data:image/png;base64,AAAA'],
        paramValues: { quality: 'high' }
      })
    )
  })

  it('returns a permanent note when the configured model cannot edit images', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    getImageGenerationSupport.mockReturnValue(generateSupport)

    const result = await generateImageFromPrompt({ prompt: 'edit it', image_ids: ['f1'] })

    expect(result).toEqual({ error: PAINTING_EDIT_NOT_SUPPORTED_NOTE })
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
