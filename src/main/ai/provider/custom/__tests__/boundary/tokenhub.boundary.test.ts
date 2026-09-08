import type { VendorBag } from '@main/ai/utils/imageOptions'
import { describe, expect, it, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { buildTokenhubTransport } from '../../tokenhub/tokenhubProvider'
import { captureImageRequest, submitWithResponse } from './captureRequest'

/**
 * TokenHub image request boundary. The `/v1/wand/*` routes and request fields
 * follow https://cloud.tencent.com/document/product/1823/130080.
 * Retrieved 2026-07-27.
 */

const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
const HUNYUAN = { id: 'hy-image-v3', endpoint: '/v1/wand/hunyuan-image/v3-generation', isSync: true }
const SEEDREAM = { id: 'seedream-image-v5.0-lite', endpoint: '/v1/wand/si-image/generation', isSync: true }
const VIDU = { id: 'vidu-image-q2', endpoint: '/v1/wand/vidu-image/generation' }

function submitInput(
  overrides: Partial<ImageGenerationSubmitInput<VendorBag>> = {}
): ImageGenerationSubmitInput<VendorBag> {
  return {
    modelId: 'hy-image-v3',
    prompt: 'a fox',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    modelDescriptor: HUNYUAN,
    providerParams: {},
    ...overrides
  }
}

describe('tokenhub transport — outbound submit body', () => {
  it('posts Hunyuan fields to the registry endpoint on the host origin', async () => {
    const transport = buildTokenhubTransport(settings)
    const captured = await captureImageRequest(
      transport,
      submitInput({
        size: '1280x768',
        seed: 42,
        files: [{ type: 'url', url: 'https://ref.example/a.jpg' }],
        providerParams: { promptEnhancement: true }
      })
    )

    expect(captured.url).toBe('https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v3-generation')
    expect(captured.method).toBe('POST')
    expect(captured.body).toEqual({
      model: 'hy-image-v3',
      prompt: 'a fox',
      images: ['https://ref.example/a.jpg'],
      size: '1280x768',
      seed: 42,
      revise: true
    })
  })

  it('posts Seedream image and sequential-generation fields', async () => {
    const transport = buildTokenhubTransport(settings)
    const captured = await captureImageRequest(
      transport,
      submitInput({
        modelId: 'seedream-image-v5.0-lite',
        modelDescriptor: SEEDREAM,
        providerParams: {
          imageResolution: '4K',
          outputFormat: 'png',
          addWatermark: false,
          sequentialImageGeneration: 'auto',
          maxImages: 4
        }
      })
    )

    expect(captured.url).toBe('https://tokenhub.tencentmaas.com/v1/wand/si-image/generation')
    expect(captured.body).toEqual({
      model: 'seedream-image-v5.0-lite',
      prompt: 'a fox',
      response_format: 'url',
      size: '4K',
      output_format: 'png',
      watermark: false,
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 4 }
    })
  })

  it('posts Vidu fields and requires a non-empty task id', async () => {
    const transport = buildTokenhubTransport(settings)
    const input = submitInput({
      modelId: 'vidu-image-q2',
      modelDescriptor: VIDU,
      aspectRatio: '9:16',
      seed: 7,
      providerParams: { resolution: '2K' }
    })
    const captured = await captureImageRequest(transport, input)

    expect(captured.url).toBe('https://tokenhub.tencentmaas.com/v1/wand/vidu-image/generation')
    expect(captured.body).toEqual({
      model: 'vidu-image-q2',
      prompt: 'a fox',
      aspect_ratio: '9:16',
      resolution: '2K',
      seed: 7
    })
    await expect(submitWithResponse(transport, input, { task_id: 'task-1', state: 'created' })).resolves.toEqual({
      kind: 'submitted',
      taskId: 'task-1'
    })
    await expect(submitWithResponse(transport, input, { state: 'created' })).rejects.toThrow(/Invalid JSON response/)
  })
})

describe('tokenhub transport — task query', () => {
  it('queries the encoded Vidu task id and normalizes success', async () => {
    const transport = buildTokenhubTransport(settings)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ state: 'success', creations: [{ url: 'https://img.example/a.png' }] }))
      )
    try {
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      await expect(
        transport.task.query('task/1', {
          signal: new AbortController().signal,
          modelDescriptor: VIDU,
          headers: undefined,
          providerParams: {}
        })
      ).resolves.toEqual({ kind: 'completed', imageUrls: ['https://img.example/a.png'] })

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('https://tokenhub.tencentmaas.com/v1/wand/vidu-image/tasks/task%2F1')
      expect(init?.method).toBe('GET')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('rejects missing and unknown states instead of treating them as pending', async () => {
    const transport = buildTokenhubTransport(settings)
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    for (const response of [{}, { state: 'waiting' }]) {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
      try {
        await expect(
          transport.task.query('task-1', {
            signal: new AbortController().signal,
            modelDescriptor: VIDU,
            headers: undefined,
            providerParams: {}
          })
        ).rejects.toThrow(/Invalid JSON response/)
      } finally {
        fetchSpy.mockRestore()
      }
    }
  })
})
