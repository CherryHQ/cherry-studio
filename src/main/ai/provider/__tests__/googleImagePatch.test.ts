import { createGoogle } from '@ai-sdk/google'
import type { ImageModelV4CallOptions } from '@ai-sdk/provider'
import { generateImage } from 'ai'
import { describe, expect, it } from 'vitest'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const options: ImageModelV4CallOptions = {
  prompt: 'a fox',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {}
}
const json = (body: unknown) => Response.json(body)

describe('Google V4 image compatibility', () => {
  it.each(['imagen-4.0-generate-001', 'models/imagen-4.0-generate-001'])(
    'preserves Imagen parameters and output at %s',
    async (id) => {
      const requests: Array<{ url: string; body: any; headers: Headers }> = []
      const google = createGoogle({
        apiKey: 'test-key',
        baseURL: 'https://google.test/v1beta',
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
          return json({ predictions: [{ bytesBase64Encoded: png }, { bytesBase64Encoded: png }] })
        }
      })
      const model = google.image(id)
      expect(model.specificationVersion).toBe('v4')
      const result = await generateImage({
        model,
        prompt: 'a fox',
        n: 2,
        aspectRatio: '16:9',
        providerOptions: { google: { personGeneration: 'allow_adult' } },
        maxRetries: 0
      })
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('https://google.test/v1beta/models/imagen-4.0-generate-001:predict')
      expect(requests[0].body).toEqual({
        instances: [{ prompt: 'a fox' }],
        parameters: { sampleCount: 2, aspectRatio: '16:9', personGeneration: 'allow_adult' }
      })
      expect(requests[0].headers.get('x-goog-api-key')).toBe('test-key')
      expect(result.images.map((image) => image.base64)).toEqual([png, png])
    }
  )

  it.each(['gemini-3-pro-image-preview', 'models/gemini-3-pro-image-preview', 'google/gemini-3-pro-image-preview'])(
    'keeps Gemini generation and editing on generateContent at %s',
    async (id) => {
      const requests: Array<{ url: string; body: any }> = []
      const model = createGoogle({
        apiKey: 'test-key',
        baseURL: 'https://google.test/v1beta',
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
          return json({
            candidates: [
              {
                content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: png } }] },
                finishReason: 'STOP'
              }
            ]
          })
        }
      }).image(id)
      for (const files of [undefined, [{ type: 'file' as const, mediaType: 'image/png', data: png }]]) {
        const result = await model.doGenerate({
          ...options,
          files,
          aspectRatio: '16:9',
          providerOptions: { google: { imageConfig: { imageSize: '2K' } } }
        })
        expect(result.images).toEqual([png])
      }
      expect(requests.map((request) => request.url)).toEqual(
        Array(2).fill(`https://google.test/v1beta/${id.includes('models/') ? id : `models/${id}`}:generateContent`)
      )
      expect(requests[0].body.contents[0].parts).toEqual([{ text: 'a fox' }])
      expect(requests[1].body.contents[0].parts).toEqual([
        { text: 'a fox' },
        { inlineData: { mimeType: 'image/png', data: png } }
      ])
      expect(requests[1].body.generationConfig).toMatchObject({
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' }
      })
    }
  )

  it('rejects unsupported edits without issuing a request', async () => {
    let requests = 0
    const google = createGoogle({
      apiKey: 'test-key',
      fetch: async () => {
        requests++
        return json({})
      }
    })
    const file = { type: 'file' as const, mediaType: 'image/png', data: png }
    await expect(google.image('imagen-4.0-generate-001').doGenerate({ ...options, files: [file] })).rejects.toThrow(
      /image editing/
    )
    for (const id of ['imagen-4.0-generate-001', 'gemini-3-pro-image-preview']) {
      await expect(google.image(id).doGenerate({ ...options, mask: file })).rejects.toThrow(/mask/)
    }
    expect(requests).toBe(0)
  })
})
