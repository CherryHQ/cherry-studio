import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSupport } from '@shared/data/types/model'

import { generateImageFromPrompt, PAINTING_GEOMETRY_UNSUPPORTED_NOTE } from '../painting'

const support = {
  modes: {
    generate: {
      supports: {
        size: { type: 'enum', options: ['1024x1024', '1792x1024', 'auto', 'custom'] },
        aspectRatio: { type: 'enum', options: ['ASPECT_16_9', 'ASPECT_1_1', 'auto'] },
        imageResolution: { type: 'enum', options: ['2K'] },
        customSize: { type: 'size', minSide: 512, maxSide: 2048, pairedEnumKey: 'size' }
      }
    },
    edit: { supports: { size: { type: 'enum', options: ['1024x1024'] } } }
  }
} satisfies ImageGenerationSupport
const model = { uniqueModelId: 'openai::model' as const, support }
const generateImage = vi.fn()

describe('assistant image geometry', () => {
  beforeEach(() => {
    generateImage.mockReset().mockResolvedValue({ files: [] })
    MockApplicationUtils.setService('AiService', { generateImage })
    MockApplicationUtils.setService('FileManager', {
      read: vi.fn().mockResolvedValue({ content: 'AAAA', mime: 'image/png' })
    })
  })
  afterEach(() => MockApplicationUtils.resetServices())
  it.each([
    [{}, { aspectRatio: 'ASPECT_16_9' }],
    [{ size: '', aspectRatio: null }, { aspectRatio: 'ASPECT_16_9' }],
    [{ size: '1024x1024' }, { size: '1024x1024' }],
    [{ aspectRatio: 'auto' }, { aspectRatio: 'auto' }],
    [{ imageResolution: '2K' }, { imageResolution: '2K' }],
    [
      { aspectRatio: 'ASPECT_1_1', imageResolution: '2K' },
      { aspectRatio: 'ASPECT_1_1', imageResolution: '2K' }
    ],
    [{ size: 'custom', customSize: '1536x1024' }, { size: '1536x1024' }],
    [{ size: 'invalid' }, {}]
  ])('honours explicit geometry %j', async (input, expected) => {
    await generateImageFromPrompt({ prompt: 'test', ...input }, undefined, model, {
      aspectRatio: 'ASPECT_16_9'
    })
    expect(generateImage.mock.calls[0][0].paramValues).toEqual(expected)
  })
  it('does not inherit size when a ratio is explicit', async () => {
    await generateImageFromPrompt({ prompt: 'test', aspectRatio: 'ASPECT_1_1' }, undefined, model, {
      size: '1792x1024'
    })
    expect(generateImage.mock.calls[0][0].paramValues).toEqual({ aspectRatio: 'ASPECT_1_1' })
  })
  it('allows explicit geometry despite a stale default', async () => {
    await generateImageFromPrompt({ prompt: 'test', size: '1024x1024' }, undefined, model, {
      aspectRatio: 'ASPECT_4_3'
    })
    expect(generateImage.mock.calls[0][0].paramValues).toEqual({ size: '1024x1024' })
  })
  it('rejects an inherited value unsupported in the actual mode', async () => {
    const result = await generateImageFromPrompt({ prompt: 'edit', image_ids: ['f1'] }, undefined, model, {
      aspectRatio: 'ASPECT_16_9'
    })
    expect(result).toEqual({ error: PAINTING_GEOMETRY_UNSUPPORTED_NOTE })
    expect(generateImage).not.toHaveBeenCalled()
  })
  it('keeps an empty bag without a default and inherits a supported size', async () => {
    await generateImageFromPrompt({ prompt: 'test' }, undefined, model)
    expect(generateImage.mock.calls[0][0].paramValues).toEqual({})
    await generateImageFromPrompt({ prompt: 'test' }, undefined, model, { size: '1792x1024' })
    expect(generateImage.mock.calls[1][0].paramValues).toEqual({ size: '1792x1024' })
  })
})
