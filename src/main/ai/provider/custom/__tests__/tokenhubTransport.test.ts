import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import { createTokenhubTransport, TokenhubApiError, TokenhubTaskFailedError } from '../tokenhub/tokenhubTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

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
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    expect(body).toEqual({
      model: 'hy-image-v3',
      prompt: 'a fox',
      images: ['https://ref/a.jpg'],
      size: '1280x768',
      seed: 42,
      revise: true
    })
    expect(result).toEqual({ imageUrls: ['https://img/hy.png'] })
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
    expect(result).toEqual({ taskId: 'task-1' })
  })

  it('rejects a vidu submit that returns no task_id instead of completing empty', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ state: 'created' }))

    await expect(
      transport.submit({ ...baseInput, modelId: 'vidu-image-q2', modelDescriptor: VIDU, prompt: 'x' })
    ).rejects.toBeInstanceOf(TokenhubApiError)
  })

  it('surfaces a 4xx as a PaintingGenerateError carrying the API message; 401 as REQ_ERROR_TOKEN', async () => {
    const transport = createTokenhubTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'content blocked' } }, 422))
      .mockResolvedValueOnce(jsonResponse({}, 401))

    const blocked = await transport
      .submit({ ...baseInput, modelId: 'hy-image-v3', modelDescriptor: HUNYUAN, prompt: 'x' })
      .catch((e) => e)
    expect(blocked).toBeInstanceOf(PaintingGenerateError)
    expect(blocked).toMatchObject({ code: 'REMOTE_ERROR', message: 'content blocked' })

    const unauthorized = await transport
      .submit({ ...baseInput, modelId: 'hy-image-v3', modelDescriptor: HUNYUAN, prompt: 'x' })
      .catch((e) => e)
    expect(unauthorized).toMatchObject({ code: 'REQ_ERROR_TOKEN' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('poll', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('GETs the vidu task until success and returns creations[].url', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ state: 'queueing' }))
        .mockResolvedValueOnce(jsonResponse({ state: 'processing' }))
        .mockResolvedValueOnce(jsonResponse({ state: 'success', creations: [{ url: 'https://img/v.png' }, {}] }))

      const promise = transport.poll('task/1', {})
      await vi.advanceTimersByTimeAsync(10000)

      await expect(promise).resolves.toEqual(['https://img/v.png'])
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(lastRequest(fetchMock).url).toBe('https://tokenhub.tencentmaas.com/v1/wand/vidu-image/tasks/task%2F1')
      expect(lastRequest(fetchMock).init.method).toBe('GET')
    })

    it('fails fast on state=failed with the vendor reason', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ state: 'failed', err_msg: 'moderation rejected' }))

      const error = await transport.poll('task-1', {}).catch((e) => e)
      expect(error).toBeInstanceOf(TokenhubTaskFailedError)
      expect(error.message).toBe('moderation rejected')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('stops polling when the signal aborts', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ state: 'processing' }))
      const controller = new AbortController()

      const promise = transport.poll('task-1', { signal: controller.signal })
      await Promise.resolve()
      controller.abort()

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(15000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries a 5xx poll response as transient but ends on a 4xx', async () => {
      const transport = createTokenhubTransport({ apiKey: 'token' })
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({ error: { message: 'no such task' } }, 404))

      const promise = transport.poll('task-1', {}).catch((e) => e)
      await vi.advanceTimersByTimeAsync(5000)
      const error = await promise

      expect(error).toBeInstanceOf(PaintingGenerateError)
      expect(error.message).toBe('no such task')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
