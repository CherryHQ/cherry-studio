import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

import { RuntimeExecutor } from '../executor'
import type { RuntimeProviderCallEvent } from '../types'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIo8AAAAASUVORK5CYII='
const bytes = new Uint8Array(Buffer.from(png, 'base64'))

describe('RuntimeExecutor.generateImage provider boundary', () => {
  it('batches generation and records each provider call with aggregate image usage', async () => {
    const requests: Array<Record<string, any>> = []
    const events: RuntimeProviderCallEvent[] = []
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        return Response.json({
          created: 0,
          data: Array.from({ length: body.n }, () => ({ b64_json: png })),
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
        })
      }
    })
    const executor = RuntimeExecutor.create('openai', provider, {})
    const result = await executor.generateImage({
      model: 'gpt-image-1',
      prompt: 'A cherry',
      n: 3,
      maxImagesPerCall: 2,
      size: '1024x1024',
      providerOptions: { openai: { quality: 'low' } },
      onProviderCall: (event) => {
        events.push(event)
      }
    })
    expect(requests.map(({ n }) => n)).toEqual([2, 1])
    expect(requests[0]).toMatchObject({ model: 'gpt-image-1', prompt: 'A cherry', quality: 'low', size: '1024x1024' })
    expect(result.images.map((image) => image.uint8Array)).toEqual([bytes, bytes, bytes])
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 40, totalTokens: 60 })
    expect(events.map((event) => event.modality === 'image' && event.imageCount)).toEqual([2, 1])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(2)
  })

  it('sends reference image and mask bytes to the edit endpoint', async () => {
    let endpoint: string | undefined
    let form: FormData | undefined
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async (url, init) => {
        endpoint = String(url)
        form = init?.body as FormData
        return Response.json({ created: 0, data: [{ b64_json: png }] })
      }
    })
    const executor = RuntimeExecutor.create('openai', provider, {})
    const result = await executor.generateImage({
      model: executor.imageModel('gpt-image-1'),
      prompt: { text: 'Make it blue', images: [bytes], mask: bytes }
    })
    expect(endpoint).toBe('https://api.openai.com/v1/images/edits')
    expect(form?.get('prompt')).toBe('Make it blue')
    expect(form?.get('model')).toBe('gpt-image-1')
    const image = form?.get('image') as File
    const mask = form?.get('mask') as File
    expect(image.type).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes)
    expect(new Uint8Array(await mask.arrayBuffer())).toEqual(bytes)
    expect(result.image.uint8Array).toEqual(bytes)
  })

  it('does not retry or record a completed image call after cancellation', async () => {
    let calls = 0
    const events: RuntimeProviderCallEvent[] = []
    const controller = new AbortController()
    const provider = createOpenAI({
      apiKey: 'test',
      fetch: async (_url, init) => {
        calls++
        controller.abort()
        init?.signal?.throwIfAborted()
        throw new Error('unreachable')
      }
    })
    const executor = RuntimeExecutor.create('openai', provider, {})
    await expect(
      executor.generateImage({
        model: 'gpt-image-1',
        prompt: 'A cherry',
        abortSignal: controller.signal,
        onProviderCall: (event) => {
          events.push(event)
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
    expect(events).toEqual([])
  })
})
