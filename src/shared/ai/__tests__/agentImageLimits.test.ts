import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import {
  AgentImageLimitError,
  assertAgentImageLimit,
  countAgentImageAttachments,
  countAgentImageFileParts,
  isAgentImagePart,
  normalizeAgentImageLimitFailure,
  parseUpstreamImageLimit,
  resolveMaxAgentImages
} from '../agentImageLimits'

function visionModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test::vision-model',
    providerId: 'test',
    name: 'Vision Model',
    capabilities: ['image-recognition'],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true,
    ...overrides
  } as unknown as Model
}

describe('isAgentImagePart', () => {
  it('accepts declared image media types', () => {
    expect(isAgentImagePart({ type: 'file', mediaType: 'image/png' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', mediaType: 'IMAGE/JPEG' })).toBe(true)
  })

  it('accepts composer FILE_TYPE image markers', () => {
    expect(isAgentImagePart({ type: 'image', ext: '.png', name: 'shot' })).toBe(true)
  })

  it('accepts image data URLs', () => {
    expect(isAgentImagePart({ type: 'file', url: 'data:image/png;base64,AQID' })).toBe(true)
  })

  it('accepts known image extensions on ext, filename and file URL', () => {
    expect(isAgentImagePart({ type: 'image', ext: '.JPG' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', filename: 'scan "final".PNG' })).toBe(true)
    expect(isAgentImagePart({ type: 'file', url: 'file:///tmp/photo.webp?x=1#y' })).toBe(true)
  })

  it('rejects non-image parts', () => {
    expect(isAgentImagePart({ type: 'file', mediaType: 'video/mp4', filename: 'clip.mp4' })).toBe(false)
    expect(isAgentImagePart({ type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' })).toBe(false)
    expect(isAgentImagePart({ type: 'text', text: 'image.png' } as never)).toBe(false)
    expect(isAgentImagePart(null)).toBe(false)
    expect(isAgentImagePart(undefined)).toBe(false)
  })
})

describe('countAgentImageFileParts', () => {
  it('counts zero images for text-only input', () => {
    expect(countAgentImageFileParts([{ type: 'text', text: 'hello' }])).toBe(0)
    expect(countAgentImageFileParts([])).toBe(0)
    expect(countAgentImageFileParts(undefined)).toBe(0)
  })

  it('counts a single image', () => {
    expect(
      countAgentImageFileParts([
        { type: 'text', text: 'look' },
        { type: 'file', mediaType: 'image/jpeg', filename: 'a.jpg' }
      ])
    ).toBe(1)
  })

  it('counts multiple images in order among mixed parts', () => {
    const parts = [
      { type: 'text', text: 'compare' },
      { type: 'file', mediaType: 'image/png', filename: 'first.png' },
      { type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'second.jpg' },
      { type: 'file', mediaType: 'image/gif', filename: 'third.gif' }
    ]
    expect(countAgentImageFileParts(parts)).toBe(3)
  })
})

describe('countAgentImageAttachments', () => {
  it('counts composer image attachments', () => {
    expect(
      countAgentImageAttachments([
        { type: 'image', ext: '.png', name: 'a' },
        { type: 'document', ext: '.pdf', name: 'b' },
        { type: 'image', ext: '.jpg', name: 'c' }
      ])
    ).toBe(2)
  })
})

describe('resolveMaxAgentImages', () => {
  it('returns undefined for non-vision models (existing fallbacks apply)', () => {
    expect(resolveMaxAgentImages(visionModel({ capabilities: [] }))).toBeUndefined()
    expect(resolveMaxAgentImages(undefined)).toBeUndefined()
  })

  it('returns undefined for vision models without a declared limit', () => {
    expect(resolveMaxAgentImages(visionModel())).toBeUndefined()
  })

  it('honours an explicit per-model declaration', () => {
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 1 } as Partial<Model>))).toBe(1)
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 0 } as Partial<Model>))).toBe(0)
  })

  it('ignores invalid declarations', () => {
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: -1 } as Partial<Model>))).toBeUndefined()
    expect(resolveMaxAgentImages(visionModel({ maxAgentImages: 'many' } as Partial<Model>))).toBeUndefined()
  })
})

describe('assertAgentImageLimit', () => {
  const singleImageModel = visionModel({ maxAgentImages: 1 } as Partial<Model>)

  it('passes one image against a single-image limit', () => {
    expect(() =>
      assertAgentImageLimit([{ type: 'file', mediaType: 'image/png', filename: 'a.png' }], singleImageModel)
    ).not.toThrow()
  })

  it('passes multiple images when the model is unlimited', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    expect(() => assertAgentImageLimit(parts, visionModel())).not.toThrow()
  })

  it('throws with the actual limit for over-limit input', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    let error: unknown
    try {
      assertAgentImageLimit(parts, singleImageModel, { runtime: 'claude-code' })
    } catch (thrown) {
      error = thrown
    }
    expect(error).toBeInstanceOf(AgentImageLimitError)
    const limitError = error as AgentImageLimitError
    expect(limitError.limit).toBe(1)
    expect(limitError.count).toBe(2)
    expect(limitError.runtime).toBe('claude-code')
    expect(limitError.i18nKey).toBe('agent_image_limit_exceeded')
  })

  it('honours an explicit override limit', () => {
    const parts = [
      { type: 'file', mediaType: 'image/png', filename: 'a.png' },
      { type: 'file', mediaType: 'image/jpeg', filename: 'b.jpg' }
    ]
    expect(() => assertAgentImageLimit(parts, undefined, { maxImages: 2 })).not.toThrow()
    expect(() => assertAgentImageLimit(parts, undefined, { maxImages: 1 })).toThrow(AgentImageLimitError)
  })
})

describe('parseUpstreamImageLimit', () => {
  it('parses the reported single-image rejection', () => {
    expect(parseUpstreamImageLimit('At most 1 image(s) may be provided in one prompt')).toBe(1)
  })

  it('parses other upstream limits', () => {
    expect(parseUpstreamImageLimit('at most 4 images in one prompt')).toBe(4)
    expect(parseUpstreamImageLimit('At most 10 image(s) may be provided in one prompt.')).toBe(10)
  })

  it('returns undefined for unrelated failures', () => {
    expect(parseUpstreamImageLimit('Request failed with status 400')).toBeUndefined()
    expect(parseUpstreamImageLimit(undefined)).toBeUndefined()
    expect(parseUpstreamImageLimit('')).toBeUndefined()
  })
})

describe('normalizeAgentImageLimitFailure', () => {
  it('converts an upstream rejection into the limit error shape', () => {
    const error = normalizeAgentImageLimitFailure(new Error('At most 1 image(s) may be provided in one prompt'), 2, {
      runtime: 'pi'
    })
    expect(error).toBeInstanceOf(AgentImageLimitError)
    expect(error?.limit).toBe(1)
    expect(error?.count).toBe(2)
  })

  it('returns undefined when the count fits the parsed limit', () => {
    expect(normalizeAgentImageLimitFailure(new Error('At most 2 image(s) may be provided'), 2)).toBeUndefined()
  })

  it('returns undefined for unrelated errors', () => {
    expect(normalizeAgentImageLimitFailure(new Error('boom'), 3)).toBeUndefined()
  })
})
