import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { ImageModelV3 } from '@ai-sdk/provider'
import { generateImage, NoImageGeneratedError } from 'ai'
import { describe, expect, it } from 'vitest'

// Guards the download half of patches/ai@6.0.185.patch: a failed url download must drop the
// image, not store the url where the base64 bytes belong (AiService then writes a corrupt file).
describe('patched ai generateImage url download', () => {
  function imageModel(images: string[]): ImageModelV3 {
    return {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test-image',
      maxImagesPerCall: 10,
      doGenerate: async () => ({
        images,
        warnings: [],
        response: { timestamp: new Date(0), modelId: 'test-image', headers: {} }
      })
    } as unknown as ImageModelV3
  }

  const bytes = new Uint8Array([1, 2, 3])

  it.each([
    { name: 'fileData alone', includeInline: false, includeUrl: true, downloadSucceeds: true, expected: ['AQID'] },
    { name: 'inlineData alone', includeInline: true, includeUrl: false, downloadSucceeds: false, expected: ['QUJD'] },
    {
      name: 'mixed with an unavailable URL',
      includeInline: true,
      includeUrl: true,
      downloadSucceeds: false,
      expected: ['QUJD']
    }
  ])(
    'returns image bytes for Gemini relay $name',
    async ({ includeInline, includeUrl, downloadSucceeds, expected }) => {
      const url = 'https://images.example.com/generated.png'
      const google = createGoogleGenerativeAI({
        apiKey: 'test',
        baseURL: 'https://relay.example.com/v1beta',
        fetch: async (input) => {
          expect(String(input)).toBe('https://relay.example.com/v1beta/models/gemini-3.1-flash-image:generateContent')
          return Response.json({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  role: 'model',
                  parts: [
                    ...(includeInline ? [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] : []),
                    ...(includeUrl ? [{ fileData: { mimeType: 'image/png', fileUri: url } }] : []),
                    { text: 'Generated image' }
                  ]
                }
              }
            ]
          })
        }
      })

      const result = await generateImage({
        model: google.image('gemini-3.1-flash-image'),
        prompt: 'a fox',
        experimental_download: async (downloads) =>
          downloads.map((download) =>
            downloadSucceeds && download.url.href === url ? { data: bytes, mediaType: 'image/png' } : null
          )
      })

      expect(result.images.map((image) => image.base64)).toEqual(expected)
    }
  )

  it('drops an image whose download failed instead of keeping the url as data', async () => {
    const result = await generateImage({
      model: imageModel(['https://img/gone.png', 'https://img/ok.png']),
      prompt: 'a fox',
      n: 2,
      experimental_download: async (downloads) =>
        downloads.map(({ url }) => (url.href.includes('gone') ? null : { data: bytes, mediaType: 'image/png' }))
    })

    expect(result.images).toHaveLength(1)
    expect(result.images[0].uint8Array).toEqual(bytes)
  })

  it('drops only the failing image when the download throws', async () => {
    const result = await generateImage({
      model: imageModel(['https://img/throws.png', 'https://img/ok.png']),
      prompt: 'a fox',
      n: 2,
      experimental_download: async (downloads) => {
        if (downloads[0].url.href.includes('throws')) throw new Error('DownloadError')
        return downloads.map(() => ({ data: bytes, mediaType: 'image/png' }))
      }
    })

    expect(result.images).toHaveLength(1)
  })

  it('downloads an uppercase scheme and drops an unparseable one', async () => {
    const result = await generateImage({
      model: imageModel(['https://exa mple.com/x.png', 'HTTPS://img/upper.png']),
      prompt: 'a fox',
      n: 2,
      experimental_download: async (downloads) => downloads.map(() => ({ data: bytes, mediaType: 'image/png' }))
    })

    expect(result.images).toHaveLength(1)
    expect(result.images[0].uint8Array).toEqual(bytes)
  })

  it('reports no image generated when every download failed', async () => {
    await expect(
      generateImage({
        model: imageModel(['https://img/gone.png']),
        prompt: 'a fox',
        experimental_download: async (downloads) => downloads.map(() => null)
      })
    ).rejects.toBeInstanceOf(NoImageGeneratedError)
  })

  it('passes a b64_json result through without downloading', async () => {
    const result = await generateImage({
      model: imageModel(['QUJD']),
      prompt: 'a fox',
      experimental_download: async () => {
        throw new Error('must not download a non-url image')
      }
    })

    expect(result.images[0].base64).toBe('QUJD')
  })
})
