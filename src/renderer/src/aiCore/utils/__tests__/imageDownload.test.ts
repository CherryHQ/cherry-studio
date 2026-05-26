import type { ImageModelV3 } from '@ai-sdk/provider'
import { generateImage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { classifyImageOutput, downloadImageUrls } from '../imageDownload'

describe('classifyImageOutput', () => {
  it('treats http(s) values as pass-through URLs', () => {
    expect(classifyImageOutput('https://cdn.example.com/a.png')).toEqual({
      type: 'url',
      url: 'https://cdn.example.com/a.png'
    })
    expect(classifyImageOutput('http://x/y.jpg')).toEqual({ type: 'url', url: 'http://x/y.jpg' })
  })

  it('strips a redundant data:<mediaType>;base64, prefix', () => {
    expect(classifyImageOutput('data:image/png;base64,QUJD')).toEqual({ type: 'base64', base64: 'QUJD' })
    expect(classifyImageOutput('data:image/jpeg;base64,Zm9v')).toEqual({ type: 'base64', base64: 'Zm9v' })
  })

  it('passes already-raw base64 through unchanged', () => {
    expect(classifyImageOutput('QUJDREVG')).toEqual({ type: 'base64', base64: 'QUJDREVG' })
  })
})

describe('downloadImageUrls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads URL outputs into bytes for AI SDK generated files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      )
    )

    const result = await downloadImageUrls([{ url: new URL('https://a/1.png'), isUrlSupportedByModel: false }])

    expect(result).toEqual([{ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }])
  })

  it('prevents AI SDK from treating URL outputs as base64', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      )
    )
    const model: ImageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'url-image-model',
      maxImagesPerCall: 1,
      async doGenerate() {
        return {
          images: ['https://a/1.png'],
          warnings: [],
          response: {
            timestamp: new Date(),
            modelId: 'url-image-model',
            headers: {}
          }
        }
      }
    }

    const result = await generateImage({
      model,
      prompt: 'a fox',
      experimental_download: downloadImageUrls
    })

    expect(result.images[0].base64).toBe('AQID')
    expect(result.images[0].mediaType).toBe('image/png')
  })
})
