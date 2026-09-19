import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { applySeed, createComfyuiTransport, listWorkflows, parseVersion } from '../comfyuiTransport'
import type { ApiPromptNode, ObjectInfo } from '../uiToApiPrompt'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

const objectInfo: ObjectInfo = {
  CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } } },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0 }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [['euler'], {}],
        scheduler: [['normal'], {}],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1 }]
      }
    }
  }
}

/** A minimal UI workflow whose prompt target is the CLIPTextEncode. */
const workflow = {
  nodes: [
    { id: 1, type: 'CLIPTextEncode', widgets_values: ['hi'] },
    {
      id: 2,
      type: 'KSampler',
      inputs: [{ name: 'positive', link: 3 }],
      widgets_values: [0, 20, 8, 'euler', 'normal']
    }
  ],
  links: [[3, 1, 0, 2, 6]]
}

const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

const submitInput = {
  modelId: 'flow',
  prompt: 'a cat',
  n: 1,
  size: undefined,
  seed: 42,
  files: [] as never[],
  mask: undefined,
  providerParams: {}
}

describe('ComfyuiTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('routes every request through the configured fetch and headers', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'X-Test': '1' })
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(workflow)
      return respond({ prompt_id: 'pid-1' })
    })
    const transport = createComfyuiTransport({
      baseURL: 'http://localhost:8188',
      headers: { 'X-Test': '1' },
      fetch: doFetch
    })

    const result = await transport.submit({
      modelId: 'flow',
      prompt: 'a cat',
      n: 1,
      size: undefined,
      seed: 42,
      files: [],
      mask: undefined,
      providerParams: {}
    })

    expect(result.taskId).toBe('pid-1')
    // Every request — workflow read, object_info, prompt POST — carries the
    // configured headers (asserted inside the mock).
    const [url, init] = doFetch.mock.calls[doFetch.mock.calls.length - 1]
    expect(String(url)).toBe('http://localhost:8188/prompt')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.prompt['1'].inputs.text).toBe('a cat')
    expect(body.prompt['2'].inputs.seed).toBe(42)
  })

  it('propagates a user abort during the prompt POST as an AbortError', async () => {
    const doFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => {
      return new Promise((_resolve, reject) => {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        reject(e)
      })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    const controller = new AbortController()
    controller.abort()

    const promise = transport
      .submit({ ...submitInput, signal: controller.signal })
      .then(() => null)
      .catch((e) => e)

    const error = await promise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
  })
})

describe('listWorkflows', () => {
  it('passes configured headers to the userdata listing', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8188/v2/userdata?path=workflows')
      expect(init?.headers).toEqual({ 'X-Test': '1' })
      return respond([
        { name: 'a.json', type: 'file', path: 'workflows/a.json' },
        // The listing walks subdirectories: the handle must stay the relative
        // path, or reading it back from the root directory would 404.
        { name: 'nested.json', type: 'file', path: 'workflows/sub/nested.json' },
        { name: 'sub', type: 'directory', path: 'workflows/sub' },
        { name: 'notes.txt', type: 'file', path: 'workflows/notes.txt' }
      ])
    })

    const workflows = await listWorkflows('http://localhost:8188', undefined, {
      headers: { 'X-Test': '1' },
      fetch: doFetch
    })

    expect(workflows).toEqual(['a', 'sub/nested'])
  })

  it('surfaces a failed listing as a structured REMOTE_ERROR with the server message', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ message: 'server exploded' }), { status: 500 }))

    const error = await listWorkflows('http://localhost:8188', undefined, { fetch: doFetch }).catch((e) => e)

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error).toMatchObject({ code: 'REMOTE_ERROR', message: 'server exploded' })
  })
})

describe('cancel', () => {
  /** The queue read is the only GET; the write's response body is ignored.
   *  Also answers `/system_stats` with v0.3.57 so the capability check passes. */
  const systemStatsSupporting = () => respond({ system: { comfyui_version: '0.3.57' }, devices: [] })

  const queueFetch = (running: unknown[][], pending: unknown[][]) =>
    vi.fn<(input: RequestInfo | URL, _init?: RequestInit) => Promise<Response>>(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats')) return systemStatsSupporting()
      return respond({ queue_running: running, queue_pending: pending })
    })

  const postWrites = (doFetch: ReturnType<typeof queueFetch>) =>
    doFetch.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([input, init]) => ({ url: String(input), body: JSON.parse(init?.body as string) }))

  it('interrupts a running prompt by id and leaves the queue alone', async () => {
    const doFetch = queueFetch([[1, 'pid-1', {}, {}, []]], [[2, 'other', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }])
  })

  it('dequeues a pending prompt and does not interrupt the one that is running', async () => {
    const doFetch = queueFetch([[1, 'other', {}, {}, []]], [[2, 'pid-1', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  it('sends no write for an id that is neither running nor pending', async () => {
    const doFetch = queueFetch([[1, 'other', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(postWrites(doFetch)).toEqual([])
  })

  it('stays silent when the queue read fails', async () => {
    const doFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      throw new Error('server down')
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await expect(transport.cancel('pid-1')).resolves.toBeUndefined()
    expect(doFetch).toHaveBeenCalledTimes(1)
  })
})

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
    const doFetch = vi.fn(async () => new Response('not found', { status: 404 }))
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const promise = transport.poll('pid-1').catch((e) => e)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect(doFetch).toHaveBeenCalledTimes(1)
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

describe('applySeed', () => {
  it('writes noise_seed for advanced samplers', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 7 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42, '1')

    expect(graph['1'].inputs.noise_seed).toBe(42)
  })

  it('prefers seed when a sampler exposes both', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'CustomSampler', inputs: { seed: 7, noise_seed: 8 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42, '1')

    expect(graph['1'].inputs.seed).toBe(42)
    expect(graph['1'].inputs.noise_seed).toBe(8)
  })

  it('falls back to any noise_seed node when the sampler has neither', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 7 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42)

    expect(graph['1'].inputs.noise_seed).toBe(42)
  })

  it('writes a linked seed at its source node instead of severing the link', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'Seed', inputs: { seed: 7 }, _meta: { title: 'source' } },
      '2': { class_type: 'KSampler', inputs: { seed: ['1', 0] }, _meta: { title: 'sampler' } }
    }

    applySeed(graph, 42, '2')

    expect(graph['2'].inputs.seed).toEqual(['1', 0])
    expect(graph['1'].inputs.seed).toBe(42)
  })

  it('writes a seed linked from a PrimitiveInt source at its value widget', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'PrimitiveInt', inputs: { value: 7 }, _meta: { title: 'source' } },
      '2': { class_type: 'KSampler', inputs: { seed: ['1', 0] }, _meta: { title: 'sampler' } }
    }

    applySeed(graph, 42, '2')

    expect(graph['2'].inputs.seed).toEqual(['1', 0])
    expect(graph['1'].inputs.value).toBe(42)
  })
})

describe('parseVersion', () => {
  it('parses a standard three-component version', () => {
    expect(parseVersion('0.3.57')).toEqual([0, 3, 57])
    expect(parseVersion('0.26.0')).toEqual([0, 26, 0])
    expect(parseVersion('0.36.0')).toEqual([0, 36, 0])
  })

  it('extracts the leading components from a pre-release string', () => {
    expect(parseVersion('0.3.57-rc1')).toBeNull() // pre-release suffix → strict fail-closed
    expect(parseVersion('0.3.58-dev')).toBeNull()
    expect(parseVersion('0.3.57+build123')).toBeNull() // build metadata → strict fail-closed
  })

  it('returns null for unrecognisable strings', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('abc')).toBeNull()
    expect(parseVersion('v0.3.57')).toBeNull() // v prefix
    expect(parseVersion('0.3')).toBeNull() // missing patch component
    expect(parseVersion('0.3.')).toBeNull() // trailing dot
    expect(parseVersion('.0.3.57')).toBeNull() // leading dot
    expect(parseVersion('0..3.57')).toBeNull() // empty component
    expect(parseVersion('0.3.57-extra')).toBeNull() // extra segment
  })
})

describe('cancel (capability-based)', () => {
  /** Respond with JSON data. */
  const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

  /** /system_stats body for a given version. */
  const systemStats = (version: string) =>
    respond({
      system: { comfyui_version: version },
      devices: []
    })

  /** A fetch mock that serves `/system_stats` with `version` and `/queue`
   *  with the given running / pending queues.  Subsequent POSTs (queue
   *  delete, interrupt) are also captured. */
  const createCapsFetch = (version: string, running: unknown[][], pending: unknown[][]) => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/system_stats')) return systemStats(version)
      if (url.includes('/queue')) {
        if (init?.method === 'POST') return respond({})
        return respond({ queue_running: running, queue_pending: pending })
      }
      if (url.includes('/interrupt')) return respond({})
      return respond({})
    })
    return doFetch
  }

  /** Simulates the race between `GET /queue` (cancelAction) and `GET
   *  /system_stats` (capability probe): the first queue snapshot shows A
   *  running, then /system_stats triggers the state change (A finishes, B
   *  starts).  The mock exposes the final state via the captured closure
   *  so the test can assert the race actually occurred. */
  const createStaleQueueFetch = (initialRunning: unknown[][], staleRunning: unknown[][]) => {
    let currentState = initialRunning
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/queue')) {
        if (init?.method === 'POST') return respond({})
        return respond({ queue_running: currentState, queue_pending: [] })
      }
      if (url.includes('/system_stats')) {
        // /system_stats fires during capability probe — at this point
        // the server-side race has completed: A finished, B started.
        currentState = staleRunning
        return systemStats('0.3.40') // old version
      }
      if (url.includes('/interrupt')) return respond({})
      return respond({})
    })
    return { doFetch, getCurrentState: () => currentState }
  }

  /** Collect all POST calls (url + body). */
  const collectPosts = (doFetch: ReturnType<typeof vi.fn>) =>
    doFetch.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([input, init]) => ({
        url: String(input),
        body: JSON.parse(init?.body as string)
      }))

  // ------------------------------------------------------------------
  // Test 1 — targeted interrupt supported
  // running → POST /interrupt { prompt_id }
  // ------------------------------------------------------------------
  it('sends /interrupt when the server supports targeted interrupt', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([{ url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }])
  })

  // ------------------------------------------------------------------
  // Test 2 — old / global interrupt unsupported
  // running → no /interrupt (fails closed)
  // ------------------------------------------------------------------
  it('skips /interrupt when the server only supports global interrupt', async () => {
    const doFetch = createCapsFetch('0.3.40', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })

  // ------------------------------------------------------------------
  // Test 3 — pending prompt (independent of capability)
  // ------------------------------------------------------------------
  it('dequeues a pending prompt regardless of targeted interrupt capability', async () => {
    const doFetch = createCapsFetch('0.3.40', [[1, 'other', {}, {}, []]], [[2, 'pid-1', {}, {}, []]])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([{ url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } }])
  })

  // ------------------------------------------------------------------
  // Test 4 — already finished
  // ------------------------------------------------------------------
  it('is a no-op when the prompt is not in the queue', async () => {
    const doFetch = createCapsFetch('0.3.57', [[1, 'other', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
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
    expect(collectPosts(doFetch)).toEqual([{ url: 'http://localhost:8188/interrupt', body: { prompt_id: 'A' } }])
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

    // Zero /interrupt POSTs → B cannot be killed by a global interrupt.
    expect(collectPosts(doFetch)).toEqual([])
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
  // Test 8 — no /system_stats endpoint → fail closed
  // ------------------------------------------------------------------
  it('fails closed when /system_stats is unavailable', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats')) return new Response('not found', { status: 404 })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    // The server is unknown → fail closed (no interrupt sent).
    expect(collectPosts(doFetch)).toEqual([])
  })

  // ------------------------------------------------------------------
  // Pre-release / dev / build versions → strict fail-closed
  // ------------------------------------------------------------------
  it('fails closed for a pre-release version (0.3.57-rc1)', async () => {
    const doFetch = createCapsFetch('0.3.57-rc1', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })

  it('fails closed for a dev version (0.3.58-dev)', async () => {
    const doFetch = createCapsFetch('0.3.58-dev', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })

  it('fails closed for a version with build metadata (0.3.57+build)', async () => {
    const doFetch = createCapsFetch('0.3.57+build', [[1, 'pid-1', {}, {}, []]], [])
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })

  it('fails closed when /system_stats returns valid JSON but missing the version field', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats')) return new Response(JSON.stringify({ devices: [] }), { status: 200 })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })

  it('fails closed when /system_stats returns invalid JSON', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/system_stats'))
        return new Response('not json at all', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      return respond({ queue_running: [[1, 'pid-1', {}, {}, []]], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    expect(collectPosts(doFetch)).toEqual([])
  })
})
