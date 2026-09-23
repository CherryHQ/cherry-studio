import { describe, expect, it } from 'vitest'

import { buildArkImageTransport } from '../ark/arkImageTransport'
import type { ImageGenerationSubmitInput } from '../imageGenerationModel'

const input: ImageGenerationSubmitInput = {
  modelId: 'doubao-seedream-4-5',
  prompt: 'a blue square',
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: { imageResolution: '2K' }
}

describe('Ark Seedream standard image transport', () => {
  it('retains the service error message for rejected edits', async () => {
    const transport = buildArkImageTransport({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { message: 'Use /v1/images/edits with multipart image upload' }
          }),
          { status: 400 }
        )
    })
    await expect(transport.submit(input)).rejects.toThrow('HTTP 400): Use /v1/images/edits with multipart image upload')
  })
  it('keeps a useful status when the error body is not JSON', async () => {
    const transport = buildArkImageTransport({
      fetch: async () => new Response('<html>Bad Gateway</html>', { status: 502 })
    })
    await expect(transport.submit(input)).rejects.toThrow('Ark image request failed (HTTP 502)')
  })
  it('uses JSON reference images on the generation endpoint, retaining credential and cancellation', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const signal = new AbortController().signal
    const transport = buildArkImageTransport({
      apiKey: 'test-key',
      fetch: async (url, init) => {
        request = { url: String(url), init }
        return new Response(JSON.stringify({ data: [{ url: 'https://images.example/result.png' }] }), { status: 200 })
      }
    })
    const output = await transport.submit({
      ...input,
      signal,
      files: [{ type: 'file', mediaType: 'image/png', data: 'AAAA' }]
    })
    expect(request?.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(JSON.parse(request?.init?.body as string)).toEqual({
      model: input.modelId,
      prompt: input.prompt,
      response_format: 'url',
      stream: false,
      size: '2K',
      image: ['data:image/png;base64,AAAA'],
      sequential_image_generation: 'disabled'
    })
    expect(request?.init?.signal).toBe(signal)
    expect(output.imageUrls).toEqual(['https://images.example/result.png'])
  })
  it('preserves grouping controls and rejects a paid empty success', async () => {
    let body: any
    const transport = buildArkImageTransport({
      fetch: async (_url, init) => {
        body = JSON.parse(init?.body as string)
        return new Response('{"data":[]}')
      }
    })
    await expect(
      transport.submit({
        ...input,
        providerParams: { sequentialImageGeneration: 'auto', maxImages: 3, addWatermark: false }
      })
    ).rejects.toThrow('no images')
    expect(body).toMatchObject({ watermark: false, sequential_image_generation_options: { max_images: 3 } })
    expect(body).not.toHaveProperty('n')
  })
})
