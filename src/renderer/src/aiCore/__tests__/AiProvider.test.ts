import { describe, expect, it } from 'vitest'

import AiProvider from '../AiProvider'

const convertImageResult = AiProvider.prototype['convertImageResult'] as (result: {
  images?: Array<{ base64?: string; mediaType?: string }>
}) => string[]

describe('AiProvider.convertImageResult', () => {
  it('should convert base64 images to data URIs', () => {
    const result = convertImageResult({
      images: [{ base64: 'aGVsbG8=', mediaType: 'image/png' }]
    })

    expect(result).toEqual(['data:image/png;base64,aGVsbG8='])
  })

  it('should default mediaType to image/png when not provided', () => {
    const result = convertImageResult({
      images: [{ base64: 'aGVsbG8=' }]
    })

    expect(result).toEqual(['data:image/png;base64,aGVsbG8='])
  })

  it('should pass through HTTP URLs as-is', () => {
    const result = convertImageResult({
      images: [{ base64: 'https://example.com/image.png' }]
    })

    expect(result).toEqual(['https://example.com/image.png'])
  })

  it('should pass through HTTPS URLs as-is', () => {
    const result = convertImageResult({
      images: [{ base64: 'http://example.com/image.png' }]
    })

    expect(result).toEqual(['http://example.com/image.png'])
  })

  it('should handle mixed base64 and URL results', () => {
    const result = convertImageResult({
      images: [{ base64: 'aGVsbG8=', mediaType: 'image/jpeg' }, { base64: 'https://cdn.example.com/img.png' }]
    })

    expect(result).toEqual(['data:image/jpeg;base64,aGVsbG8=', 'https://cdn.example.com/img.png'])
  })

  it('should skip images without base64', () => {
    const result = convertImageResult({
      images: [{ mediaType: 'image/png' }]
    })

    expect(result).toEqual([])
  })

  it('should return empty array when no images', () => {
    const result = convertImageResult({ images: [] })
    expect(result).toEqual([])
  })

  it('should return empty array when images is undefined', () => {
    const result = convertImageResult({})
    expect(result).toEqual([])
  })
})
