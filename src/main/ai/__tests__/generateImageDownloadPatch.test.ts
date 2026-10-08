import type { ImageModelV3 } from '@ai-sdk/provider'
import { generateImage, NoImageGeneratedError } from 'ai'
import { describe, expect, it } from 'vitest'

// Guards the download half of patches/ai@7.0.127.patch: a failed url download must drop the
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
        providerMetadata: { test: { images: images.map((_, index) => ({ index })) } },
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        warnings: [],
        response: { timestamp: new Date(0), modelId: 'test-image', headers: {} }
      })
    } as unknown as ImageModelV3
  }

  const bytes = new Uint8Array([1, 2, 3])

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
    expect(result.images[0].providerMetadata).toEqual({ test: { index: 1 } })
    expect(result.calls[0].images).toEqual(result.images)
    expect(result.calls[0].warnings).toEqual(result.warnings)
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    expect(result.warnings).toContainEqual({
      type: 'other',
      message: '1 of 2 generated images could not be downloaded and were dropped'
    })
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

  it('decodes data URLs without downloading and keeps their media type', async () => {
    const result = await generateImage({
      model: imageModel(['data:image/jpeg;base64,QUJD']),
      prompt: 'a fox',
      experimental_download: async () => {
        throw new Error('unexpected download')
      }
    })
    expect(result.image.base64).toBe('QUJD')
    expect(result.image.mediaType).toBe('image/jpeg')
  })

  it('propagates cancellation during a result download', async () => {
    const controller = new AbortController()
    await expect(
      generateImage({
        model: imageModel(['https://img/slow.png']),
        prompt: 'a fox',
        abortSignal: controller.signal,
        experimental_download: async () => {
          controller.abort()
          controller.signal.throwIfAborted()
          return []
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
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
