import { describe, expect, it } from 'vitest'

import { openAIImageSupport } from '../../../../packages/provider-registry/src/creators/imageCanvases'
import { resolveImageCanvasParams, calculateImageSize, imageSizeSelection } from '../imageCanvases'

const support = openAIImageSupport()
describe('official image canvas requests', () => {
  it('maps a selected tier and ratio to a declared wire size without leaking UI parameters', () => {
    expect(
      resolveImageCanvasParams(support, 'generate', { imageResolution: '2K', aspectRatio: '16:9', quality: 'high' })
    ).toEqual({ size: '2048x1152', quality: 'high' })
  })
  it('rejects unsupported combinations rather than choosing a different canvas', () => {
    expect(() => resolveImageCanvasParams(support, 'edit', { imageResolution: '4K', aspectRatio: '1:4' })).toThrow(
      'Configure pixel'
    )
    expect(() => resolveImageCanvasParams(support, 'generate', { size: '1024x1024', aspectRatio: '16:9' })).toThrow(
      'not both'
    )
  })
  it('keeps explicit supported sizes and uses declared defaults when no size is requested', () => {
    expect(resolveImageCanvasParams(support, 'generate', { size: 'auto' })).toEqual({ size: 'auto' })
    expect(resolveImageCanvasParams(support, 'generate', {})).toEqual({ size: '1024x1024' })
  })
  it("does not reinterpret another protocol's native resolution", () => {
    expect(resolveImageCanvasParams(undefined, 'generate', { resolution: '2k', aspectRatio: '16:9' })).toEqual({
      resolution: '2k',
      aspectRatio: '16:9'
    })
  })
  it('selects a valid tier default only when the caller omitted a ratio', () => {
    expect(resolveImageCanvasParams(support, 'generate', { imageResolution: '4K' })).toEqual({ size: '2880x2880' })
    expect(() =>
      resolveImageCanvasParams(support, 'generate', { background: 'transparent', outputFormat: 'jpeg' })
    ).toThrow('PNG or WebP')
    expect(resolveImageCanvasParams(support, 'generate', { outputFormat: 'png', outputCompression: 80 })).toEqual({
      size: '1024x1024',
      outputFormat: 'png'
    })
  })
})

it('combines longest edge, pixel budget and alignment', () => {
  expect(calculateImageSize('16:9', { longEdge: 3840, maxPixels: 8294400 })).toBe('3840x2160')
  expect(calculateImageSize('1:1', { longEdge: 3840, maxPixels: 8294400 })).toBe('2880x2880')
  expect(calculateImageSize('9:16', { longEdge: 3840, maxPixels: 8294400 })).toBe('2160x3840')
})
it('uses native preview metadata without changing native request parameters', () => {
  const native = {
    modes: { generate: { supports: {}, expectedSizes: [{ resolution: '2K', aspectRatio: '16:9', size: '2752x1536' }] } }
  }
  const params = { imageResolution: '2K', aspectRatio: '16:9' }
  expect(imageSizeSelection(native, 'generate', params).pixels).toBe('2752x1536')
  expect(resolveImageCanvasParams(native, 'generate', params)).toEqual(params)
  expect(imageSizeSelection(undefined, 'generate', params).pixels).toBeUndefined()
})
