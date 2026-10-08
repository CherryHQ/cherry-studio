import { ImageGenerationSupportSchema } from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import { prepareImageRequest } from '../prepareImageRequest'

const inputImage = 'data:image/png;base64,AQI='
const declaration = ImageGenerationSupportSchema.parse({
  supports: {
    seed: {
      type: 'text'
    },
    addWatermark: {
      type: 'switch'
    }
  },
  inputs: {
    images: {
      min: 0,
      max: {
        kind: 'known',
        value: 2
      }
    },
    prompt: 'required',
    mask: 'unknown',
    mediaTypes: {
      kind: 'unknown'
    }
  },
  operations: {
    upscale: {
      supports: {
        seed: null,
        addWatermark: null
      },
      inputs: {
        images: {
          min: 1,
          max: {
            kind: 'known',
            value: 1
          }
        },
        prompt: 'optional'
      }
    }
  }
})

describe('prepareImageRequest', () => {
  it.each(['ASPECT_16_9', '16x9', '16_9', '0:1', '-1:9', 'Infinity:1', 'invalid', null])(
    'rejects invalid ratio %s even without a model capability',
    (aspectRatio) => {
      expect(() =>
        prepareImageRequest(
          {
            prompt: 'a fox',
            // @ts-expect-error Untyped in-process callers must not bypass canonical validation.
            paramValues: { aspectRatio }
          },
          undefined
        )
      ).toThrowError(expect.objectContaining({ code: 'OPERATION_FAILED' }))
    }
  )

  it('requires a declared auto capability but allows explicit ratios on unconfigured models', () => {
    expect(() =>
      prepareImageRequest({ prompt: 'a fox', paramValues: { aspectRatio: 'auto' } }, undefined)
    ).toThrowError(expect.objectContaining({ code: 'OPERATION_FAILED' }))
    expect(
      prepareImageRequest({ prompt: 'a fox', paramValues: { aspectRatio: '16:9' } }, undefined).paramValues
    ).toEqual({ aspectRatio: '16:9' })
  })

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
      operation: 'generate'
    })
    expect(input.prompt).toBe('  a fox  ')
  })

  it('normalizes an empty input array to no images and keeps omitted values omitted', () => {
    expect(prepareImageRequest({ prompt: 'a fox', paramValues: {}, inputImages: [] }, declaration)).toEqual({
      prompt: 'a fox',
      paramValues: {},
      inputImages: undefined,
      mask: undefined,
      operation: 'generate'
    })
  })

  it('enforces image minimum and maximum before execution', () => {
    expect(() =>
      prepareImageRequest(
        { prompt: 'a fox', paramValues: {} },
        { ...declaration, inputs: { ...declaration.inputs, images: { ...declaration.inputs.images, min: 1 } } }
      )
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
