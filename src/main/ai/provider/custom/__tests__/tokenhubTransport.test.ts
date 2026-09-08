import { APICallError } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import { createTokenhubTransport } from '../tokenhub/tokenhubTransport'

const HUNYUAN = { id: 'hy-image-v3', endpoint: '/v1/wand/hunyuan-image/v3-generation', isSync: true }
const SEEDREAM = { id: 'seedream-image-v5.0-lite', endpoint: '/v1/wand/si-image/generation', isSync: true }
const VIDU = { id: 'vidu-image-q2', endpoint: '/v1/wand/vidu-image/generation' }

const baseInput = {
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function lastRequest(fetchMock: MockInstance<typeof fetch>): { url: string; init: RequestInit; body: unknown } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url: call[0], init: call[1], body: call[1].body ? JSON.parse(call[1].body as string) : undefined }
}

describe('TokenhubTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts the hunyuan body (size / seed / revise / images) to the descriptor endpoint and returns data[].url', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token', baseURL: 'https://tokenhub.tencentmaas.com' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ data: [{ url: 'https://img/hy.png', revised_prompt: 'x' }] }))

    const result = await transport.submit({
      ...baseInput,
      modelId: 'hy-image-v3',
      modelDescriptor: HUNYUAN,
      prompt: 'a fox',
      size: '1280x768',
      seed: 42,
      files: [{ type: 'url', url: 'https://ref/a.jpg' }],
      providerParams: { promptEnhancement: true }
    })

    const { url, init, body } = lastRequest(fetchMock)
    expect(url).toBe('https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v3-generation')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
    expect(body).toEqual({
      model: 'hy-image-v3',
      prompt: 'a fox',
      images: ['https://ref/a.jpg'],
      size: '1280x768',
      seed: 42,
      revise: true
    })
    expect(result).toEqual({ kind: 'completed', imageUrls: ['https://img/hy.png'] })
  })

  it('maps seedream imageResolution to size and only sends max_images under sequential auto', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ data: [{ url: 'https://img/s.png' }] }))

    await transport.submit({
      ...baseInput,
      modelId: 'seedream-image-v5.0-lite',
      modelDescriptor: SEEDREAM,
      prompt: 'a cat',
      providerParams: {
        imageResolution: '4K',
        outputFormat: 'png',
        addWatermark: false,
        sequentialImageGeneration: 'disabled',
        maxImages: 5
      }
    })
    expect(lastRequest(fetchMock).body).toEqual({
      model: 'seedream-image-v5.0-lite',
      prompt: 'a cat',
      response_format: 'url',
      size: '4K',
      output_format: 'png',
      watermark: false,
      sequential_image_generation: 'disabled'
    })

    await transport.submit({
      ...baseInput,
      modelId: 'seedream-image-v5.0-lite',
      modelDescriptor: SEEDREAM,
      prompt: 'a cat',
      providerParams: { sequentialImageGeneration: 'auto', maxImages: 5 }
    })
    expect(lastRequest(fetchMock).body).toMatchObject({
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 5 }
    })
  })

  it('submits vidu with the native aspectRatio + resolution and returns the task id', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ task_id: 'task-1', state: 'created' }))

    const result = await transport.submit({
      ...baseInput,
      modelId: 'vidu-image-q2',
      modelDescriptor: VIDU,
      prompt: 'a dog',
      aspectRatio: '9:16',
      seed: 7,
      providerParams: { resolution: '2K' }
    })

    expect(lastRequest(fetchMock).url).toBe('https://tokenhub.tencentmaas.com/v1/wand/vidu-image/generation')
    expect(lastRequest(fetchMock).body).toEqual({
      model: 'vidu-image-q2',
      prompt: 'a dog',
      aspect_ratio: '9:16',
      resolution: '2K',
      seed: 7
    })
    expect(result).toEqual({ kind: 'submitted', taskId: 'task-1' })
  })

  it('routes requests through the provider fetch and merges provider headers under the bearer auth', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [{ url: 'https://img/x' }] }))
    const transport = createTokenhubTransport({
      apiKey: 'token',
      fetch: providerFetch,
      headers: { 'X-App': 'cherry' }
    })

    await transport.submit({
      ...baseInput,
      modelId: 'hy-image-v3',
      modelDescriptor: HUNYUAN,
      prompt: 'x',
      headers: { 'X-Request': 'once' }
    })

    expect(globalFetch).not.toHaveBeenCalled()
    const headers = new Headers(lastRequest(providerFetch as unknown as MockInstance<typeof fetch>).init.headers)
    expect(headers.get('x-app')).toBe('cherry')
    expect(headers.get('x-request')).toBe('once')
    expect(headers.get('authorization')).toBe('Bearer token')
  })

  it('rejects a vidu submit that returns no task_id instead of completing empty', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ state: 'created' }))

    await expect(
      transport.submit({ ...baseInput, modelId: 'vidu-image-q2', modelDescriptor: VIDU, prompt: 'x' })
    ).rejects.toThrow(/Invalid JSON response/)
  })

  it('surfaces structured 4xx responses as APICallError with the vendor message', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'content blocked' } }, 422))
      .mockResolvedValueOnce(jsonResponse({}, 401))

    const blocked = await transport
      .submit({ ...baseInput, modelId: 'hy-image-v3', modelDescriptor: HUNYUAN, prompt: 'x' })
      .catch((e) => e)
    expect(blocked).toBeInstanceOf(APICallError)
    expect(blocked.message).toContain('content blocked')

    const unauthorized = await transport
      .submit({ ...baseInput, modelId: 'hy-image-v3', modelDescriptor: HUNYUAN, prompt: 'x' })
      .catch((e) => e)
    expect(unauthorized).toBeInstanceOf(APICallError)
    expect(unauthorized).toMatchObject({ statusCode: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('task query', () => {
    it('GETs the Vidu task and normalizes success', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ state: 'success', creations: [{ url: 'https://img/v.png' }] }))

      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      await expect(
        transport.task.query('task/1', {
          signal: new AbortController().signal,
          modelDescriptor: VIDU,
          headers: undefined,
          providerParams: {}
        })
      ).resolves.toEqual({ kind: 'completed', imageUrls: ['https://img/v.png'] })
      expect(lastRequest(fetchMock).url).toBe('https://tokenhub.tencentmaas.com/v1/wand/vidu-image/tasks/task%2F1')
      expect(lastRequest(fetchMock).init.method).toBe('GET')
    })

    it('normalizes pending and failed states without owning the polling loop', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ state: 'processing' }))
        .mockResolvedValueOnce(jsonResponse({ state: 'failed', err_msg: 'moderation rejected' }))

      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      const context = {
        signal: new AbortController().signal,
        modelDescriptor: VIDU,
        headers: undefined,
        providerParams: {}
      }
      await expect(transport.task.query('task-1', context)).resolves.toEqual({ kind: 'pending' })
      await expect(transport.task.query('task-1', context)).resolves.toEqual({
        kind: 'failed',
        message: 'moderation rejected'
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
