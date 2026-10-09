import { generateImage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createSiliconProvider } from '../silicon/siliconProvider'

describe('createSiliconProvider', () => {
  // https://api-docs.siliconflow.cn/docs/api/images-generations-post — retrieved 2026-09-09.
  it.each([
    ['Qwen/Qwen-Image', [1, 1, 1, 1, 1]],
    ['Kwai-Kolors/Kolors', [4, 1]]
  ] as const)('splits %s batches according to its actual per-call limit', async (modelId, counts) => {
    const requests: Request[] = []
    const provider = createSiliconProvider({
      apiKey: 'key',
      fetch: async (url, init) => {
        const request = new Request(url, init)
        requests.push(request)
        const body = await request.clone().json()
        return Response.json({
          images: Array.from({ length: body.batch_size ?? 1 }, () => ({ url: 'data:image/png;base64,AQID' }))
        })
      }
    })
    const result = await generateImage({ model: provider.imageModel(modelId), prompt: 'a fox', n: 5, maxRetries: 0 })
    expect(await Promise.all(requests.map(async (request) => (await request.json()).batch_size ?? 1))).toEqual(counts)
    expect(result.images).toHaveLength(5)
  })

  it.each([
    ['Qwen/Qwen-Image-Edit', 2],
    ['Qwen/Qwen-Image-Edit-2509', 4]
  ] as const)('rejects %s input overflow instead of silently dropping images', async (modelId, count) => {
    const fetch = vi.fn()
    const provider = createSiliconProvider({ apiKey: 'key', fetch })
    await expect(
      provider.imageModel(modelId).doGenerate({
        prompt: 'restyle',
        n: 1,
        size: undefined,
        seed: undefined,
        aspectRatio: undefined,
        mask: undefined,
        providerOptions: {},
        files: Array.from({ length: count }, () => ({ type: 'url', url: 'https://image.example/input.png' }))
      })
    ).rejects.toThrow('input images')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes Qwen-specific cfg through and attaches input files as image / image2 / image3', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ images: [{ url: 'https://x/y.png' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    )
    const provider = createSiliconProvider({ apiKey: 'sk-test', fetch })
    const model = provider.imageModel('Qwen/Qwen-Image-Edit-2509')

    await model.doGenerate({
      prompt: 'restyle these',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      mask: undefined,
      providerOptions: { silicon: { cfg: 7.5 } },
      files: [
        { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
        { type: 'url', url: 'https://x/in2.png' }
      ]
    })

    const sent = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.cfg).toBe(7.5)
    expect(sent.image).toBe(`data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`)
    expect(sent.image2).toBe('https://x/in2.png')
    expect(sent).not.toHaveProperty('image3')
    expect(sent).not.toHaveProperty('batch_size')
  })
})
