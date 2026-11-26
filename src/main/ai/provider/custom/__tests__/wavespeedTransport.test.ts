import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import { buildWavespeedTransport } from '../wavespeed/wavespeedProvider'
import { createWavespeedTransport } from '../wavespeed/wavespeedTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

const GENERATE = {
  id: 'bytedance/seedream-v5.5',
  endpoint: '/api/v3/bytedance/seedream-v5.5',
  mode: 'generate' as const
}
const EDIT = { id: 'bytedance/seedream-v5.5', endpoint: '/api/v3/bytedance/seedream-v5.5/edit', mode: 'edit' as const }

const baseInput = {
  modelId: 'bytedance/seedream-v5.5',
  prompt: 'a red fox in snow',
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  modelDescriptor: GENERATE,
  providerParams: {}
} satisfies ImageGenerationSubmitInput

function envelope(data: unknown, code = 200, message = 'success', status = 200): Response {
  return new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function request(fetchMock: MockInstance<typeof fetch>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit]
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error
  )
}

describe('WavespeedTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('submit', () => {
    it('posts only the mapped fields to the generate endpoint on the image origin', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ id: 'pred-1', status: 'created' }))
      const transport = buildWavespeedTransport({ apiKey: 'ws-key', baseURL: 'https://llm.wavespeed.ai/v1' })

      const result = await transport.submit({
        ...baseInput,
        aspectRatio: '16:9',
        providerParams: { imageResolution: '1.5K', outputFormat: 'jpeg', background: 'opaque', addWatermark: true }
      })

      const { url, init, body } = request(fetchMock, 0)
      expect(url).toBe('https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.5')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ws-key')
      expect(body).toEqual({
        prompt: 'a red fox in snow',
        aspect_ratio: '16:9',
        resolution: '1.5k',
        output_format: 'jpeg',
        background: 'opaque'
      })
      expect(result).toEqual({ taskId: 'pred-1' })
    })

    it('sends reference images to the edit endpoint as data URLs', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ id: 'pred-2' }))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      await transport.submit({
        ...baseInput,
        modelDescriptor: EDIT,
        files: [
          { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
          { type: 'url', url: 'https://example.com/ref.jpg' }
        ]
      })

      const { url, body } = request(fetchMock, 0)
      expect(url).toBe('https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.5/edit')
      expect(body.images).toEqual(['data:image/png;base64,iVBORw0KGgo=', 'https://example.com/ref.jpg'])
    })

    it('omits aspect_ratio from an edit request when no ratio was chosen', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ id: 'pred-3' }))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      await transport.submit({
        ...baseInput,
        modelDescriptor: EDIT,
        files: [{ type: 'url', url: 'https://example.com/ref.jpg' }]
      })

      expect(request(fetchMock, 0).body).not.toHaveProperty('aspect_ratio')
    })

    it('keeps an explicitly chosen ratio on an edit request', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ id: 'pred-4' }))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      await transport.submit({
        ...baseInput,
        aspectRatio: '9:16',
        modelDescriptor: EDIT,
        files: [{ type: 'url', url: 'https://example.com/ref.jpg' }]
      })

      expect(request(fetchMock, 0).body.aspect_ratio).toBe('9:16')
    })

    it('treats a non-200 envelope code on HTTP 200 as a remote error carrying the vendor message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope(null, 400, 'prompt is required'))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      const error = await rejectionOf(transport.submit(baseInput))
      expect(error).toBeInstanceOf(PaintingGenerateError)
      expect(error).toMatchObject({ code: 'REMOTE_ERROR', message: 'prompt is required' })
    })

    it('maps HTTP 401 to the token error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope(null, 401, 'Unauthorized', 401))
      const transport = createWavespeedTransport({ apiKey: 'bad' })

      await expect(transport.submit(baseInput)).rejects.toMatchObject({ code: 'REQ_ERROR_TOKEN' })
    })

    it('does not retry a submit that failed with a server error', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 502 }))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      await expect(transport.submit(baseInput)).rejects.toThrow(/502/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('poll', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('retries transient poll failures and returns the outputs once completed', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(envelope({ id: 'pred-1', status: 'processing', outputs: [] }))
        .mockResolvedValueOnce(new Response('busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
        .mockResolvedValueOnce(envelope({ id: 'pred-1', status: 'completed', outputs: ['https://cdn/out.png'] }))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      const result = transport.poll!('pred-1', {})
      await vi.runAllTimersAsync()

      await expect(result).resolves.toEqual(['https://cdn/out.png'])
      expect(fetchMock).toHaveBeenCalledTimes(4)
      for (let i = 0; i < 4; i++) {
        const { url, init } = request(fetchMock, i)
        expect(url).toBe('https://api.wavespeed.ai/api/v3/predictions/pred-1/result')
        expect(init.method).toBe('GET')
      }
    })

    it('ends with the vendor error when the prediction fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        envelope({ id: 'pred-1', status: 'failed', error: 'content flagged by moderation' })
      )
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      const result = rejectionOf(transport.poll!('pred-1', {}))
      await vi.runAllTimersAsync()

      expect(await result).toMatchObject({ code: 'REMOTE_ERROR', message: 'content flagged by moderation' })
    })

    it('stops on a client error instead of retrying it', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(envelope(null, 404, 'prediction not found', 404))
      const transport = createWavespeedTransport({ apiKey: 'ws-key' })

      const result = rejectionOf(transport.poll!('missing', {}))
      await vi.runAllTimersAsync()

      expect(await result).toMatchObject({ code: 'REMOTE_ERROR', message: 'prediction not found' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
