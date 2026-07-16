import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolApplyScope } from '../../types'

const { getPreference, generateImage } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  generateImage: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return { get: getPreference }
      if (name === 'AiService') return { generateImage }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

import { PAINTING_ERROR_NOTE, PAINTING_MODEL_NOT_CONFIGURED_NOTE } from '../../../../painting'
import { createGenerateImageToolEntry, GENERATE_IMAGE_TOOL_NAME } from '../PaintingTool'

const entry = createGenerateImageToolEntry()

function makeOptions(abortSignal = new AbortController().signal): ToolExecutionOptions {
  return {
    toolCallId: 't1',
    messages: [],
    experimental_context: { requestId: 'r1', abortSignal }
  } as ToolExecutionOptions
}

function callExecute(args: { prompt: string; n?: number }, abortSignal?: AbortSignal): Promise<unknown> {
  const execute = entry.tool.execute as (
    args: { prompt: string; n?: number },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

describe('generate_image', () => {
  beforeEach(() => {
    getPreference.mockReset()
    generateImage.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(entry.name).toBe(GENERATE_IMAGE_TOOL_NAME)
    expect(entry.namespace).toBe('media')
    expect(entry.defer).toBe('auto')
  })

  describe('applies', () => {
    const scopeWith = (enableGenerateImage?: boolean): ToolApplyScope => ({
      mcpToolIds: new Set(),
      assistant: enableGenerateImage === undefined ? undefined : ({ settings: { enableGenerateImage } } as Assistant)
    })

    it('returns false when no painting model is configured', () => {
      getPreference.mockReturnValue(null)
      expect(entry.applies!(scopeWith(true))).toBe(false)
    })

    it('returns false when the assistant toggle is off (or absent)', () => {
      getPreference.mockReturnValue('openai::dall-e-3')
      expect(entry.applies!(scopeWith(false))).toBe(false)
      expect(entry.applies!(scopeWith(undefined))).toBe(false)
    })

    it('returns true when a painting model is configured and the assistant toggle is on', () => {
      getPreference.mockReturnValue('openai::dall-e-3')
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

  it('maps the image count into the canonical parameter bag', async () => {
    getPreference.mockReturnValue('openai::dall-e-3')
    generateImage.mockResolvedValue({ files: [] })

    await callExecute({ prompt: 'a cat', n: 2 })

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ paramValues: { numImages: 2 } }))
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
