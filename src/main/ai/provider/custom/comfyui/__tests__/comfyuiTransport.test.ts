import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { createComfyuiTransport, listWorkflows, parseVersion } from '../comfyuiTransport'
import type { ObjectInfo } from '../uiToApiPrompt'
import { respond } from './comfyuiTransport.harness'

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

  it('reports a rejected workflow without waiting for a remote cleanup that has nothing to clean', async () => {
    const posts: { url: string; body: Record<string, any> }[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(workflow)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, any> })
        if (url.includes('/prompt')) return new Response('workflow rejected', { status: 400 })
        // Every cleanup request stalls: the failure must not wait for them.
        return new Promise<Response>(() => {})
      }
      return respond({})
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const error = await transport
      .submit({
        modelId: 'flow',
        prompt: 'a cat',
        n: 1,
        size: undefined,
        seed: 1,
        files: [],
        mask: undefined,
        providerParams: {}
      })
      .catch((e) => e)

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    // The body the server sent is the message; nothing waited on the phone-home.
    expect(String((error as Error).message)).toContain('workflow rejected')
    expect(posts.map((post) => post.url)).toContain('http://localhost:8188/queue')
  })

  it('names the prompt it submits and dequeues it when the answer never arrives', async () => {
    const posts: { url: string; body: Record<string, any> }[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(workflow)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, any> })
        if (url.includes('/prompt')) {
          // Accepted by the server, answer never arrives.
          return new Promise<Response>((_resolve, reject) => {
            ;(init.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
        }
        return respond({})
      }
      if (url.includes('/system_stats')) return respond({ system: { comfyui_version: '0.3.57' } })
      return respond({ queue_running: [], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    const submission = transport.submit({
      modelId: 'flow',
      prompt: 'a cat',
      n: 1,
      size: undefined,
      seed: 1,
      files: [],
      mask: undefined,
      providerParams: {}
    })
    const rejected = expect(submission).rejects.toThrow(/request_timeout/)
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    await vi.advanceTimersByTimeAsync(50)

    const promptPost = posts.find((post) => post.url.includes('/prompt'))
    const requestedId = promptPost?.body.prompt_id as string
    // ComfyUI v0.37+ rejects a `prompt_id` that is not a canonical UUID.
    expect(requestedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    const dequeued = posts.find((post) => post.url.includes('/queue') && Array.isArray(post.body.delete))
    expect(dequeued?.body.delete).toEqual([requestedId])
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

  it('reports a caller cancel during a rejected /prompt body as an AbortError', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(workflow)
      if (url.includes('/prompt')) {
        // A rejected response whose body read fails with the caller's abort.
        const body = new ReadableStream({
          start(controller) {
            ;(init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
              const e = new Error('The operation was aborted')
              e.name = 'AbortError'
              controller.error(e)
            })
          }
        })
        return new Response(body, { status: 400 })
      }
      if (url.includes('/system_stats')) return respond({ system: { comfyui_version: '0.3.57' } })
      return respond({ queue_running: [], queue_pending: [] })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    const controller = new AbortController()

    const promise = transport
      .submit({ ...submitInput, signal: controller.signal })
      .then(() => null)
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect((error as Error).message).not.toMatch(/workflow_rejected/)
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

  it('reaches the API when the host was pasted with a trailing fragment', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8188/v2/userdata?path=workflows')
      return respond([{ name: 'a.json', type: 'file', path: 'workflows/a.json' }])
    })

    // A fragment is never sent, so without stripping it every request lands on
    // the ComfyUI console's HTML root and the listing fails to parse.
    const workflows = await listWorkflows('http://localhost:8188/#', undefined, { fetch: doFetch })

    expect(workflows).toEqual(['a'])
  })

  it('surfaces a failed listing as a structured REMOTE_ERROR with the server message', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ message: 'server exploded' }), { status: 500 }))

    const error = await listWorkflows('http://localhost:8188', undefined, { fetch: doFetch }).catch((e) => e)

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect(error).toMatchObject({ code: 'REMOTE_ERROR', message: 'server exploded' })
  })
})

describe('body reads are bounded by the request deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const LIST_TIMEOUT_MS = 30_000
  const SUBMIT_TIMEOUT_MS = 60_000

  /** Headers arrive immediately; the body never does until the signal aborts. */
  const stallingBody = (signal: AbortSignal | undefined) =>
    new ReadableStream({
      start(controller) {
        signal?.addEventListener(
          'abort',
          () => {
            const e = new Error('The operation was aborted')
            e.name = 'AbortError'
            controller.error(e)
          },
          { once: true }
        )
      }
    })

  const stallingResponse = (init?: RequestInit, contentType = 'application/json') =>
    new Response(stallingBody(init?.signal as AbortSignal | undefined), {
      status: 200,
      headers: { 'Content-Type': contentType }
    })

  it('bounds a listing whose body never arrives', async () => {
    const doFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => stallingResponse(init))
    const promise = listWorkflows('http://localhost:8188', undefined, { fetch: doFetch }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect((error as Error).message).toContain('request_timeout')
  })

  it('bounds a submit whose /prompt body never arrives', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.endsWith('/prompt')) return stallingResponse(init)
      return respond(workflow)
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    const promise = transport.submit(submitInput as never).catch((e) => e)
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS)
    const error = await promise

    expect(error).toBeInstanceOf(PaintingGenerateError)
    expect((error as PaintingGenerateError).code).toBe('REMOTE_ERROR')
    expect((error as Error).message).toContain('request_timeout')
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
