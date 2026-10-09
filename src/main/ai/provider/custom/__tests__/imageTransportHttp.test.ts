import { APICallError } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withImageTransportRequestTimeout } from '../imageTransportHttp'
import { resumeImageTransport } from '../imageTransportRuntime'
import { createModelscopeTransport } from '../modelscope/modelscopeTransport'

const context = {
  modelDescriptor: undefined,
  headers: undefined,
  providerParams: {},
  signal: new AbortController().signal
}

describe('image HTTP failure classification', () => {
  it.each([400, 401, 403, 404, 422, 408, 409, 429, 500, 502, 503, 504])(
    'classifies HTTP %i at the real query boundary',
    async (status) => {
      const transport = createModelscopeTransport({
        apiKey: 'secret',
        fetch: async () => new Response('upstream unavailable', { status })
      })
      await expect(transport.task.query('accepted', context)).rejects.toMatchObject({
        statusCode: status,
        isRetryable: status === 408 || status === 409 || status === 429 || status >= 500,
        message: expect.stringContaining('upstream unavailable')
      })
    }
  )

  // Chromium error vocabulary: https://github.com/chromium/chromium/blob/main/net/base/net_error_list.h (retrieved 2026-09-09).
  it.each([new TypeError('fetch failed'), new TypeError('Failed to fetch'), new Error('net::ERR_CONNECTION_RESET')])(
    'retries a network failure from the real query boundary: %s',
    async (error) => {
      vi.useFakeTimers()
      try {
        let attempts = 0
        const transport = createModelscopeTransport({
          apiKey: 'secret',
          fetch: async () => {
            attempts++
            if (attempts === 1) throw error
            return Response.json({ task_status: 'SUCCEED', output_images: ['https://images.example/recovered.png'] })
          }
        })
        const result = resumeImageTransport({
          transport,
          taskId: 'accepted',
          context,
          onProgress: () => {},
          logContext: {}
        })
        const completed = expect(result).resolves.toEqual(['https://images.example/recovered.png'])
        await vi.runAllTimersAsync()
        await completed
        expect(attempts).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it.each([
    new TypeError('Invalid URL'),
    new Error('net::ERR_CERT_AUTHORITY_INVALID'),
    new Error('net::ERR_BLOCKED_BY_CLIENT')
  ])('does not retry configuration or security failures: %s', async (error) => {
    let attempts = 0
    const transport = createModelscopeTransport({
      apiKey: 'secret',
      fetch: async () => {
        attempts++
        throw error
      }
    })
    await expect(
      resumeImageTransport({ transport, taskId: 'accepted', context, onProgress: () => {}, logContext: {} })
    ).rejects.toBe(error)
    expect(attempts).toBe(1)
  })

  // Query control fields: https://modelscope.cn/docs/model-service/API-Inference/intro (retrieved 2026-07-27).
  it.each([
    'not json',
    '{}',
    '{"task_status":"UNKNOWN"}',
    '{"task_status":42}',
    '{"task_status":"PENDING","message":42}'
  ])('rejects invalid successful responses without transient retry: %s', async (body) => {
    const transport = createModelscopeTransport({ apiKey: 'secret', fetch: async () => new Response(body) })
    await expect(transport.task.query('accepted', context)).rejects.toMatchObject({
      statusCode: 200,
      isRetryable: false
    })
  })
})

describe('image request timeout ownership', () => {
  afterEach(() => vi.useRealTimers())

  function request(signal: AbortSignal) {
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
  }

  it('clears a completed request timer instead of aborting a later operation', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    await withImageTransportRequestTimeout({ url: 'https://provider.example', timeoutMs: 50 }, async (signal) => {
      requestSignal = signal
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(requestSignal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('turns its own timeout into a retryable API error and cleans the timer', async () => {
    vi.useFakeTimers()
    const response = withImageTransportRequestTimeout({ url: 'https://provider.example', timeoutMs: 50 }, request)
    const rejection = expect(response).rejects.toSatisfy((error) => APICallError.isInstance(error) && error.isRetryable)
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves user abort as AbortError and removes the timeout', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const response = withImageTransportRequestTimeout(
      { url: 'https://provider.example', timeoutMs: 50, signal: controller.signal },
      request
    )
    const rejection = expect(response).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
