import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createComfyuiTransport } from '../comfyuiTransport'
import { createCapsFetch, createStaleQueueFetch, postWrites, respond, systemStats } from './comfyuiTransport.harness'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

describe('cancel', () => {
  it('interrupts a running prompt by id and also dequeues it', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'pid-1', {}, {}, []]], [[2, 'other', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // Both writes are id-scoped, so neither needs the snapshot to authorise it:
    // the dequeue is a no-op for a prompt that already left the queue, and the
    // interrupt carries `prompt_id`.
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('dequeues a pending prompt and also interrupts to cover the TOCTOU race', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'other', {}, {}, []]], [[2, 'pid-1', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // Queue-delete is sent (idempotent — safe even if the prompt already
    // moved to running).  Interrupt is also sent because between the queue
    // snapshot and the action the prompt could have started running; the
    // prompt_id-scoped interrupt only touches our prompt.
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('dequeues by id even when the snapshot does not list the prompt', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'other', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // The snapshot is a hint, not an authorisation: a prompt that is missing
    // from it has usually already finished, and the dequeue is a no-op then.
    // The interrupt still goes out, because this server scopes it to the id.
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('cancels anyway when the queue read fails', async () => {
    const doFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      throw new Error('server down')
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await expect(transport.cancel('pid-1')).resolves.toBeUndefined()
    // The failed GET cannot silence the cancellation: the id-scoped dequeue is
    // still sent (and the capability probe fails closed, so no interrupt).
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })
})

describe('cancel is not gated on the queue snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const stallingUntilAborted = (init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        reject(e)
      })
    })

  it('sends the dequeue before it reads the snapshot', async () => {
    const order: string[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/system_stats')) {
        order.push('GET /system_stats')
        return respond({ system: { comfyui_version: '0.3.57' } })
      }
      if (init?.method === 'POST') {
        order.push(`POST ${url.replace('http://localhost:8188', '')}`)
        return respond({})
      }
      order.push('GET /queue')
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // The snapshot is log-only: the writes must not wait behind it.
    expect(order).toEqual(['POST /queue', 'GET /system_stats', 'POST /interrupt', 'GET /queue'])
  })

  it('resolves without waiting for the queue snapshot it only logs', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/system_stats')) {
        return respond({ system: { comfyui_version: '0.3.57' } })
      }
      if (init?.method === 'POST') return respond({})
      // The log-only snapshot never answers.
      return new Promise<Response>(() => {})
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    let settled = false
    const promise = transport.cancel('pid-1').then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(1000)

    expect(settled).toBe(true)
    await promise
  })

  it('bounds the cancellation writes so a stalled POST cannot hold cancel open', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/system_stats')) {
        return respond({ system: { comfyui_version: '0.3.57' } })
      }
      if (init?.method === 'POST') return stallingUntilAborted(init)
      return respond({ queue_running: [], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.cancel('pid-1')
    await vi.advanceTimersByTimeAsync(5000)
    await expect(promise).resolves.toBeUndefined()
  })
})

describe('cancel (capability-based)', () => {
  // ------------------------------------------------------------------
  // Test 1 — targeted interrupt supported
  // running → POST /interrupt { prompt_id }
  // ------------------------------------------------------------------
  it('sends /interrupt when the server supports targeted interrupt', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  // ------------------------------------------------------------------
  // Test 2 — old / global interrupt unsupported
  // running → no /interrupt (fails closed)
  // ------------------------------------------------------------------
  it('skips /interrupt when the server only supports global interrupt', async () => {
    const doFetch = createCapsFetch('0.3.40', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // The id-scoped dequeue is still sent — it is the only cancellation these
    // servers offer that cannot touch an unrelated prompt.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  // ------------------------------------------------------------------
  // Test 3 — pending prompt (independent of capability)
  // ------------------------------------------------------------------
  it('dequeues a pending prompt regardless of targeted interrupt capability', async () => {
    const doFetch = createCapsFetch('0.3.40', [[1, 'other', {}, {}, []]], [[2, 'pid-1', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  // ------------------------------------------------------------------
  // Test 4 — already finished
  // ------------------------------------------------------------------
  it('still dequeues by id when the prompt is not in the queue', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'other', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  // ------------------------------------------------------------------
  // Test 5 — race safety with targeted interrupt supported
  // Queue snapshot shows A running; A finishes, B starts.
  // The server's own re-check at /interrupt refuses (A not running).
  // Client still sends /interrupt { A } — server handles it safely.
  // This proves the client delegates the race to the server.
  // ------------------------------------------------------------------
  it('delegates the running re-check to the server when targeted interrupt is supported', async () => {
    // Queue snapshot says A is running; in reality B already started.
    // On ≥0.3.57 the server re-checks and skips the interrupt.
    const doFetch = createCapsFetch('0.3.57', [[1, 'A', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('A')

    // Client still sends the interrupt request, but the server (v0.3.57)
    // will re-check the running set and skip it because A is no longer
    // executing.  The client cannot know this race in advance.
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['A'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'A' } }
    ])
  })

  // ------------------------------------------------------------------
  // Test 6 — race safety with old server
  // Real request sequence in `cancel()`:
  //   1. GET /queue → A running  (cancelAction)
  //   2. GET /system_stats → old version (capability probe)
  //   3. targetedInterrupt is false → no /interrupt
  // The race "completes" when /system_stats is called (A has finished,
  // B has started).  The mock state changes at that point, proving the
  // race occurred; the transport still sends zero /interrupt requests.
  // ------------------------------------------------------------------
  it('avoids sending /interrupt on old servers even when a queue-to-capability race completes', async () => {
    const { doFetch, getCurrentState } = createStaleQueueFetch(
      // Initial queue snapshot: A running.
      [[1, 'A', {}, {}, []]],
      // After /system_stats fires: A finished, B running.
      [[2, 'B', {}, {}, []]]
    )
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('A')

    // Zero /interrupt POSTs → B cannot be killed by a global interrupt. Only
    // the id-scoped dequeue for A goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['A'] } }])
    // Verify the race actually occurred: state changed from A to B.
    expect(getCurrentState()).toEqual([[2, 'B', {}, {}, []]])
  })

  // ------------------------------------------------------------------
  // Test 7 — capabilities are cached on success
  // Two cancel calls should not re-read /system_stats.
  // ------------------------------------------------------------------
  it('caches successful capability detection', async () => {
    // A running prompt forces the capability probe; second cancel reuses the cache.
    const doFetch = createCapsFetch('0.3.60', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1') // reads /system_stats → caches success
    await transport.cancel('pid-1') // uses cached capability

    const systemStatsCalls = doFetch.mock.calls.filter(([url]) => String(url).includes('/system_stats'))
    expect(systemStatsCalls.length).toBe(1)
  })

  // ------------------------------------------------------------------
  // Test 7b — a transient non-OK probe is not cached as "unsupported"
  // ------------------------------------------------------------------
  it('re-probes after a transient non-OK capability response', async () => {
    let statsCalls = 0
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/system_stats')) {
        statsCalls += 1
        // First probe fails while the server is still coming up; the retry succeeds.
        if (statsCalls === 1) return new Response('starting up', { status: 503 })
        return systemStats('0.3.60')
      }
      if (url.includes('/queue')) {
        if (init?.method === 'POST') return respond({})
        return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
      }
      return respond({})
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1') // transient failure → must not be cached
    await transport.cancel('pid-1') // probes again, succeeds → interrupt is sent

    expect(statsCalls).toBe(2)
    // First cancel: probe failed → dequeue only. Second: the retry succeeds →
    // dequeue *and* interrupt.
    expect(postWrites(doFetch)).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  // ------------------------------------------------------------------
  // Test 8 — no /system_stats endpoint → fail closed
  // ------------------------------------------------------------------
  it('fails closed when /system_stats is unavailable', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats')) return new Response('not found', { status: 404 })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // The server is unknown → fail closed for the interrupt, which would be a
    // global kill there. The id-scoped dequeue is still sent.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  // ------------------------------------------------------------------
  // Pre-release / dev / build versions → strict fail-closed
  // ------------------------------------------------------------------
  it('fails closed for a pre-release version (0.3.57-rc1)', async () => {
    const doFetch = createCapsFetch('0.3.57-rc1', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // No interrupt (fail closed), but the id-scoped dequeue still goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  it('fails closed for a dev version (0.3.58-dev)', async () => {
    const doFetch = createCapsFetch('0.3.58-dev', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // No interrupt (fail closed), but the id-scoped dequeue still goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  it('fails closed for a version with build metadata (0.3.57+build)', async () => {
    const doFetch = createCapsFetch('0.3.57+build', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // No interrupt (fail closed), but the id-scoped dequeue still goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  it('fails closed when /system_stats returns valid JSON but missing the version field', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats')) return new Response(JSON.stringify({ devices: [] }), { status: 200 })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // No interrupt (fail closed), but the id-scoped dequeue still goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  it('fails closed when /system_stats returns invalid JSON', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats'))
        return new Response('not json at all', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // No interrupt (fail closed), but the id-scoped dequeue still goes out.
    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })
})
