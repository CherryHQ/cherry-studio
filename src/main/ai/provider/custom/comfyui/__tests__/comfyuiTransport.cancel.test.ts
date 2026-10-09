import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createComfyuiTransport } from '../comfyuiTransport'
import { postWrites, respond, stallingResponse, systemStats } from './comfyuiTransport.harness'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// Targeted interrupt/empty 200 oracle: https://github.com/comfyanonymous/ComfyUI/blob/v0.3.57/server.py (retrieved 2026-10-08).
const cancel = (transport: ReturnType<typeof createComfyuiTransport>) => {
  if (transport.task.cancel.kind !== 'supported') throw new Error('ComfyUI must expose remote cancellation')
  return transport.task.cancel.cancelRemote('pid-1', {
    signal: undefined,
    headers: undefined,
    modelDescriptor: undefined,
    providerParams: {}
  })
}
const createFetch = (version: string) =>
  vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith('/system_stats') ? systemStats(version) : new Response(null, { status: 200 })
  )

describe('ComfyUI cancellation safety', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("dequeues and interrupts only this task and accepts the server's empty acknowledgements", async () => {
    const doFetch = createFetch('0.3.57')
    await cancel(createComfyuiTransport({ fetch: doFetch }))
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
    expect(doFetch.mock.calls.some(([url, init]) => String(url).endsWith('/queue') && init?.method !== 'POST')).toBe(
      false
    )
  })

  it.each(['0.3.56', '0.3.57-rc1', '0.3.57+build', 'dev', ''])(
    'never globally interrupts on unproven version %s',
    async (version) => {
      const doFetch = createFetch(version)
      await expect(cancel(createComfyuiTransport({ fetch: doFetch }))).rejects.toThrow('cannot interrupt')
      expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
    }
  )

  it.each(['missing', 'invalid-json', '404'])(
    'fails closed for %s capabilities while still dequeuing',
    async (failure) => {
      const doFetch = vi.fn<typeof fetch>(async (input) => {
        if (!String(input).endsWith('/system_stats')) return new Response(null, { status: 200 })
        if (failure === 'missing') return respond({})
        return new Response('not json', { status: failure === '404' ? 404 : 200 })
      })
      await expect(cancel(createComfyuiTransport({ fetch: doFetch }))).rejects.toThrow('cannot interrupt')
      expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
    }
  )

  it('does not cache a failed capability probe as permanently unsupported', async () => {
    let probes = 0
    const doFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/system_stats')) {
        return ++probes === 1 ? new Response('unavailable', { status: 503 }) : systemStats('0.3.57')
      }
      return new Response(null, { status: 200 })
    })
    const transport = createComfyuiTransport({ fetch: doFetch })
    await expect(cancel(transport)).rejects.toThrow('cannot interrupt')
    await cancel(transport)
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it.each(['/queue', '/interrupt'])(
    'surfaces failed %s cancellation without skipping the other action',
    async (failedPath) => {
      const doFetch = vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/system_stats')) return systemStats('0.3.57')
        return String(input).endsWith(failedPath)
          ? new Response('denied', { status: 403 })
          : new Response(null, { status: 200 })
      })
      await expect(cancel(createComfyuiTransport({ fetch: doFetch }))).rejects.toMatchObject({ statusCode: 403 })
      expect(postWrites(doFetch).map(({ url }) => url)).toEqual([
        'http://localhost:8188/queue',
        'http://localhost:8188/interrupt'
      ])
    }
  )

  it('bounds stalled cancellation bodies so the shared runtime can complete local cancellation', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/system_stats') ? systemStats('0.3.57') : stallingResponse(init)
    )
    const result = cancel(createComfyuiTransport({ fetch: doFetch })).catch((error) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toMatchObject({ code: 'REMOTE_ERROR' })
  })
})
