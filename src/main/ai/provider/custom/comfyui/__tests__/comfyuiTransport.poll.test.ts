import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { createComfyuiTransport } from '../comfyuiTransport'
import { respond } from './comfyuiTransport.harness'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

describe('poll', () => {
  const POLL_INTERVAL_MS = 1500
  const POLL_TIMEOUT_MS = 10 * 60 * 1000
  /** A history response with one output image; the transport then fetches it. */
  const historyWithImage = () =>
    respond({
      'pid-1': {
        outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
        status: { status_str: 'success', messages: [] }
      }
    })

  /** Fetch mock whose pending promise rejects with the given error on abort. */
  const abortableFetch = (rejectWith: () => Error) =>
    vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((_input, init) => {
      return new Promise((_resolve, reject) => {
        ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => reject(rejectWith()), {
          once: true
        })
      })
    })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns fetched images as data URLs when the history has outputs', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/history/')) return historyWithImage()
      if (String(input).includes('/view?')) {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { status: 200 })
      }
      throw new Error(`unexpected url ${input}`)
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1')
    await vi.advanceTimersByTimeAsync(0)
    const images = await promise

    expect(images).toEqual(['data:image/png;base64,AQID'])
    expect(String(doFetch.mock.calls[0][0])).toBe('http://localhost:8188/history/pid-1')
    expect(String(doFetch.mock.calls[1][0])).toBe('http://localhost:8188/view?filename=out.png&subfolder=&type=output')
  })

  it('reports a failed execution even when images sit beside the error', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return respond({})
      }
      if (url.includes('/system_stats')) return respond({ system: { comfyui_version: '0.3.57' } })
      if (url.includes('/queue')) return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
      return respond({
        'pid-1': {
          status: { status_str: 'error', completed: false, messages: [['execution_error', { node_id: 9 }]] },
          // Nodes that finished before the failure leave outputs behind.
          outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } }
        }
      })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect(String((error as Error).message)).toContain('workflow_failed')
    // Nothing was downloaded: the failure is the answer, not a partial success.
    expect(doFetch.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/view'))).toEqual([])
    // And no generation is left behind on the server either.
    expect(posts).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('throws an AbortError before fetching when the signal is already aborted', async () => {
    const doFetch = vi.fn()
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch as never })
    const controller = new AbortController()
    controller.abort()

    const promise = transport.poll('pid-1', { signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('reports a mid-poll abort from the history request as an AbortError, not a generation failure', async () => {
    const doFetch = abortableFetch(() => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      return e
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    const controller = new AbortController()

    const promise = transport.poll('pid-1', { signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(doFetch).toHaveBeenCalledTimes(1)
    // A user cancel is not a failed generation: the Cancel button owns that
    // request, and cancelling here would race it.
    expect(doFetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false)
  })

  it('reports a mid-poll abort from the inter-tick sleep as an AbortError', async () => {
    const doFetch = abortableFetch(() => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      return e
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    const controller = new AbortController()

    const promise = transport.poll('pid-1', { signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    // The first history poll returns nothing; the transport sleeps until the
    // next tick. Aborting during that sleep must surface as an AbortError.
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
  })

  it('keeps polling through a transient history failure but fails on a structured one', async () => {
    let calls = 0
    const doFetch = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('network blip')
      return historyWithImage()
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const images = await promise

    expect(images).toHaveLength(1)
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('retries a transient 5xx history response instead of ending the generation', async () => {
    let calls = 0
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      calls += 1
      if (String(input).includes('/history/')) {
        if (calls < 3) return new Response('temporarily unavailable', { status: 503 })
        return historyWithImage()
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { status: 200 })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const images = await promise

    expect(images).toHaveLength(1)
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('fails fast on a terminal 4xx history response rather than looping to the timeout', async () => {
    const doFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      // The signature is what types the recorded calls, and every answer is a 404.
      void _input
      void _init
      return new Response('not found', { status: 404 })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const error = await promise

    // The 404 ends the loop after one try; the extra calls are the best-effort
    // cancellation that keeps the abandoned task off the server.
    expect(doFetch.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/history/'))).toEqual([
      'http://localhost:8188/history/pid-1'
    ])

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
  })

  it('bounds a hanging history request by the poll timeout, not as an AbortError', async () => {
    const doFetch = abortableFetch(() => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      return e
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect((error as Error).message).toContain('poll_timeout')
  })

  it('cancels the prompt when the polling deadline expires', async () => {
    // A generation the caller stopped waiting for is work the server does not
    // have to finish: the deadline has to stop it, not just stop looking at it.
    const posts: Array<{ url: string; body: Record<string, unknown> }> = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return respond({})
      }
      if (url.includes('/system_stats')) return respond({ system: { comfyui_version: '0.3.57' } })
      if (url.includes('/queue')) return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
      // The history never reports outputs, so the poll runs to its deadline.
      return respond({})
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as Error).message).toContain('poll_timeout')
    expect(posts).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('cancels the prompt when the history body stalls past the deadline', async () => {
    // The deadline aborts the body read and `withDeadline` reports it as this
    // request's timeout — a structured failure that exits the loop before the
    // normal-run-out block. The task is just as abandoned there.
    const posts: Array<{ url: string; body: Record<string, unknown> }> = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return respond({})
      }
      if (url.includes('/system_stats')) return respond({ system: { comfyui_version: '0.3.57' } })
      if (url.includes('/queue')) return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
      return new Response(
        new ReadableStream({
          start(controller) {
            ;(init?.signal as AbortSignal | undefined)?.addEventListener(
              'abort',
              () => {
                const e = new Error('The operation was aborted')
                e.name = 'AbortError'
                controller.error(e)
              },
              { once: true }
            )
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    // The history read shares the poll's budget, so its deadline reports the
    // poll timeout — the same message the loop's own exhaustion produces.
    expect((error as Error).message).toContain('poll_timeout')
    expect(posts).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('surfaces a workflow error status as a structured REMOTE_ERROR', async () => {
    const doFetch = vi.fn(async () =>
      respond({
        'pid-1': { status: { status_str: 'error', messages: [['execution_error', { node_type: 'KSampler' }]] } }
      })
    )
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error.code).toBe('REMOTE_ERROR')
  })

  it('keeps a user abort during the image download an AbortError and its download timeout a plain failure', async () => {
    const historyAndHangingView = () =>
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/history/')) return historyWithImage()
        return new Promise<Response>((_resolve, reject) => {
          ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            const e = new Error('The operation was aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
      })

    // User abort during the /view download → AbortError.
    {
      const doFetch = historyAndHangingView()
      const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
      const controller = new AbortController()
      const promise = transport.poll('pid-1', { signal: controller.signal }).catch((e) => e)
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      const error = await promise
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('AbortError')
    }

    // The transport's own IMAGE_TIMEOUT_MS timer fires → a structured failure,
    // NOT an AbortError (which downstream reads as a user cancellation).
    {
      const doFetch = historyAndHangingView()
      const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
      const promise = transport.poll('pid-1').catch((e) => e)
      await vi.advanceTimersByTimeAsync(60_001)
      const error = await promise
      expect(error).toBeInstanceOf(PaintingGenerateError)
      expect(error.code).toBe('REMOTE_ERROR')
    }
  })
})
