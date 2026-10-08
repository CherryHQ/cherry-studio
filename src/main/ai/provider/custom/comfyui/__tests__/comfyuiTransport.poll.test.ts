import { APICallError } from '@ai-sdk/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { resumeImageTransport } from '../../imageTransportRuntime'
import { createComfyuiTransport } from '../comfyuiTransport'
import { postWrites, respond, stallingResponse, systemStats } from './comfyuiTransport.harness'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// History oracle: https://github.com/comfyanonymous/ComfyUI/blob/v0.3.57/execution.py (retrieved 2026-10-08).
// HTTP oracle: https://github.com/comfyanonymous/ComfyUI/blob/v0.3.57/server.py (retrieved 2026-10-08).
const imageEntry = {
  outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
  status: { status_str: 'success', completed: true, messages: [] }
}
const context = (signal = new AbortController().signal) => ({
  signal,
  headers: { 'x-call': 'call' },
  modelDescriptor: undefined,
  providerParams: {}
})
const resume = (transport: ReturnType<typeof createComfyuiTransport>, signal?: AbortSignal) =>
  resumeImageTransport({ transport, taskId: 'pid-1', context: context(signal), onProgress: () => {}, logContext: {} })

const cleanupResponse = (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith('/system_stats')) return systemStats('0.3.57')
  if (init?.method === 'POST') return new Response(null, { status: 200 })
  return undefined
}

describe('ComfyUI through the shared task runtime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resumes pending history without resubmitting and downloads the completed bytes with call headers', async () => {
    let queries = 0
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-call')).toBe('call')
      if (String(input).includes('/history/')) return respond(++queries === 1 ? {} : { 'pid-1': imageEntry })
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    })
    const transport = createComfyuiTransport({ fetch: doFetch, headers: { 'x-call': 'provider' } })
    const result = resume(transport)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await result).toEqual(['data:image/png;base64,AQID'])
    expect(doFetch.mock.calls.map(([url]) => String(url))).toEqual([
      'http://localhost:8188/history/pid-1',
      'http://localhost:8188/history/pid-1',
      'http://localhost:8188/view?filename=out.png&subfolder=&type=output'
    ])
  })

  it('does not return partial images from a failed execution or cancel an already settled task', async () => {
    const doFetch = vi.fn(async () =>
      respond({
        'pid-1': { ...imageEntry, status: { status_str: 'error', messages: [['execution_error', { node_id: 9 }]] } }
      })
    )
    const error = await resume(createComfyuiTransport({ fetch: doFetch })).catch((error) => error)
    expect(error).toMatchObject({
      name: 'ImageTransportTaskFailedError',
      message: expect.stringContaining('workflow_failed')
    })
    expect(doFetch.mock.calls).toHaveLength(1)
  })

  it.each([
    { outputs: {} },
    { outputs: {}, status: { status_str: 'unknown' } },
    { outputs: {}, status: { status_str: 1 } },
    { ...imageEntry, outputs: { '9': { images: [{ filename: '' }] } } }
  ])('rejects malformed history rather than silently polling: %j', async (entry) => {
    const transport = createComfyuiTransport({ fetch: async () => respond({ 'pid-1': entry }) })
    await expect(transport.task.query('pid-1', context())).rejects.toMatchObject({ isRetryable: false })
  })

  it('fails a completed workflow that produced no images', async () => {
    const transport = createComfyuiTransport({
      fetch: async () => respond({ 'pid-1': { ...imageEntry, outputs: {} } })
    })
    await expect(resume(transport)).rejects.toMatchObject({
      name: 'ImageTransportTaskFailedError',
      message: expect.stringContaining('no_image')
    })
  })

  it.each(['network', '503'])('recovers from a transient %s failure', async (failure) => {
    let queries = 0
    const transport = createComfyuiTransport({
      fetch: async (input) => {
        if (String(input).includes('/history/')) {
          if (++queries === 1) {
            if (failure === 'network') throw new TypeError('fetch failed')
            return new Response('temporarily unavailable', { status: 503 })
          }
          return respond({ 'pid-1': imageEntry })
        }
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      }
    })
    const result = resume(transport)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await result).toEqual(['data:image/png;base64,AQID'])
  })

  it('stops after a terminal HTTP failure and cleans up the abandoned task', async () => {
    const doFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        cleanupResponse(input, init) ?? new Response('not found', { status: 404 })
    )
    const error = await resume(createComfyuiTransport({ fetch: doFetch })).catch((error) => error)
    expect(error).toBeInstanceOf(APICallError)
    expect(error.statusCode).toBe(404)
    expect(doFetch.mock.calls.filter(([url]) => String(url).includes('/history/'))).toHaveLength(1)
    expect(postWrites(doFetch)).toHaveLength(2)
  })

  it.each(['before', 'delay', 'history-body', 'image-body'])(
    'aborts during %s and cancels remotely exactly once',
    async (stage) => {
      const controller = new AbortController()
      const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const cleanup = cleanupResponse(input, init)
        if (cleanup) {
          expect(init?.signal?.aborted).toBe(false)
          return cleanup
        }
        if (stage === 'delay') return respond({})
        if (stage === 'history-body') return stallingResponse(init)
        if (String(input).includes('/history/')) return respond({ 'pid-1': imageEntry })
        return stallingResponse(init, 'image/png')
      })
      if (stage === 'before') controller.abort()
      const result = resume(createComfyuiTransport({ fetch: doFetch }), controller.signal).catch((error) => error)
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      expect(await result).toMatchObject({ name: 'AbortError' })
      expect(postWrites(doFetch)).toEqual([
        { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
        { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
      ])
      if (stage === 'before') expect(doFetch.mock.calls.some(([url]) => String(url).includes('/history/'))).toBe(false)
    }
  )

  it.each(['pending', 'stalled-body'])('bounds %s by the ten minute deadline and cleans up remotely', async (stage) => {
    const doFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        cleanupResponse(input, init) ?? (stage === 'pending' ? respond({}) : stallingResponse(init))
    )
    const result = resume(createComfyuiTransport({ fetch: doFetch })).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(await result).toMatchObject({ name: 'Error', message: 'Task polling timeout' })
    expect(postWrites(doFetch)).toHaveLength(2)
  })

  it('reports a stalled image download as a deadline failure, not a user abort', async () => {
    const transport = createComfyuiTransport({
      fetch: async (input, init) =>
        String(input).includes('/history/') ? respond({ 'pid-1': imageEntry }) : stallingResponse(init, 'image/png')
    })
    const result = transport.task.query('pid-1', context()).catch((error) => error)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await result).toBeInstanceOf(PaintingGenerateError)
    expect(await result).toMatchObject({ code: 'REMOTE_ERROR' })
  })
})
