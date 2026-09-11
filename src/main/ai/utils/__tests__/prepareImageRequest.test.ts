import { ImageGenerationSupportSchema } from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import { prepareImageRequest } from '../prepareImageRequest'

const inputImage = 'data:image/png;base64,AQI='
const declaration = ImageGenerationSupportSchema.parse({
  modes: {
    generate: { maxInputImages: 2, supports: { seed: { type: 'text' }, addWatermark: { type: 'switch' } } },
    edit: { maxInputImages: 2, supports: { seed: { type: 'text' }, addWatermark: { type: 'switch' } } },
    upscale: { requirePrompt: false, maxInputImages: 1, supports: {} }
  }
})

describe('prepareImageRequest', () => {
  it('normalizes the request once while preserving URL and data URL inputs', () => {
    const input = {
      prompt: '  a fox  ',
      paramValues: { seed: 0, addWatermark: false },
      inputImages: [inputImage, 'https://example.com/reference.png']
    }
    expect(prepareImageRequest(input, declaration)).toEqual({
      ...input,
      prompt: 'a fox',
      mask: undefined,
      legacyMode: 'edit'
    })
    expect(input.prompt).toBe('  a fox  ')
  })

  it('normalizes an empty input array to no images and keeps omitted values omitted', () => {
    expect(prepareImageRequest({ prompt: 'a fox', paramValues: {}, inputImages: [] }, declaration)).toEqual({
      prompt: 'a fox',
      paramValues: {},
      inputImages: undefined,
      mask: undefined,
      legacyMode: 'generate'
    })
  })

  it('enforces image minimum and maximum before execution', () => {
    expect(() =>
      prepareImageRequest({ prompt: 'a fox', paramValues: {} }, { modes: { edit: declaration.modes.edit } })
    ).toThrowError(expect.objectContaining({ code: 'EDIT_IMAGE_REQUIRED' }))
    expect(() =>
      prepareImageRequest(
        { prompt: 'a fox', paramValues: {}, inputImages: [inputImage, inputImage, inputImage] },
        declaration
      )
    ).toThrowError(expect.objectContaining({ code: 'INPUT_IMAGE_LIMIT_EXCEEDED' }))
  })

  it('rejects a mask without a source image', () => {
    expect(() => prepareImageRequest({ prompt: 'a fox', paramValues: {}, mask: inputImage }, declaration)).toThrowError(
      expect.objectContaining({ code: 'IMAGE_REQUIRED' })
    )
  })

  it('enforces required prompt but permits explicitly prompt-optional operations', () => {
    expect(() => prepareImageRequest({ prompt: ' ', paramValues: {} }, declaration)).toThrowError(
      expect.objectContaining({ code: 'PROMPT_REQUIRED' })
    )
    expect(
      prepareImageRequest({ prompt: '', operation: 'upscale', paramValues: {}, inputImages: [inputImage] }, declaration)
        .prompt
    ).toBe('')
  })

  it.each([
    'file:///tmp/image.png',
    '/tmp/image.png',
    'data:text/plain;base64,YQ==',
    'data:image/png;base64,',
    'data:image/png;base64,not base64!'
  ])('rejects invalid in-process input %s', (image) => {
    expect(() =>
      prepareImageRequest({ prompt: 'a fox', paramValues: {}, inputImages: [image] }, declaration)
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_HANDLE_REQUIRED' }))
  })

  it.each(['edit', 'merge', 'invalid', null])(
    'rejects non-business operation %s at the in-process boundary',
    (operation) => {
      expect(() =>
        prepareImageRequest(
          {
            prompt: 'a fox',
            paramValues: {},
            // @ts-expect-error Runtime validation must also reject untyped in-process callers.
            operation
          },
          declaration
        )
      ).toThrowError(expect.objectContaining({ code: 'OPERATION_FAILED' }))
    }
  )

  it('rejects undeclared operations and explicit unsupported parameters', () => {
    expect(() =>
      prepareImageRequest(
        { prompt: 'a fox', operation: 'remix', paramValues: {}, inputImages: [inputImage] },
        declaration
      )
    ).toThrowError(expect.objectContaining({ code: 'OPERATION_FAILED' }))
    expect(() => prepareImageRequest({ prompt: 'a fox', paramValues: { numImages: 2 } }, declaration)).toThrowError(
      expect.objectContaining({ code: 'OPERATION_FAILED' })
    )
  })
})
