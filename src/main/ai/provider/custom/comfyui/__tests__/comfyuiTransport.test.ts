import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { createComfyuiTransport, parseVersion } from '../comfyuiTransport'
import type { ObjectInfo } from '../uiToApiPrompt'
import { respond, stallingResponse } from './comfyuiTransport.harness'

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
  },
  ComfySwitchNode: {
    input: {
      required: { switch: ['BOOLEAN', { default: false }] },
      optional: {
        on_false: ['COMFY_MATCHTYPE_V3', { lazy: true }],
        on_true: ['COMFY_MATCHTYPE_V3', { lazy: true }]
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

/**
 * The shape the Qwen Image 2.1 templates ship: the sampler's text comes from an
 * If/Else Switch that is set to the text edited into the workflow, while the
 * branch it does not take forwards a Generate Text node's output. Both branches
 * hold a prompt-like string, and only one of them reaches the encoder.
 */
const switchWorkflow = {
  nodes: [
    {
      id: 11,
      type: 'ComfySwitchNode',
      inputs: [
        { name: 'switch', link: null },
        { name: 'on_false', link: null },
        { name: 'on_true', link: 4 }
      ],
      widgets_values: [false],
      widgets_values_named: { switch: false, on_false: 'the text edited into the workflow' }
    },
    {
      id: 12,
      type: 'CLIPTextEncode',
      inputs: [{ name: 'text', link: 3 }],
      widgets_values: ['']
    },
    {
      id: 13,
      type: 'CLIPTextEncode',
      inputs: [{ name: 'text', link: null }],
      widgets_values: ['the text a Generate Text node would make']
    },
    {
      id: 14,
      type: 'KSampler',
      inputs: [{ name: 'positive', link: 5 }],
      widgets_values: [0, 20, 8, 'euler', 'normal', 1]
    }
  ],
  links: [
    [3, 11, 0, 12, 0],
    [4, 13, 0, 11, 2],
    [5, 12, 0, 14, 0]
  ]
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

  it('writes the prompt into the branch of an If/Else Switch that reaches the encoder', async () => {
    const posts: Record<string, any>[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(switchWorkflow)
      posts.push(JSON.parse(String(init?.body)) as Record<string, any>)
      return respond({ prompt_id: 'pid-1' })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.submit(submitInput)

    // The switch is off, so the text it holds is what the encoder reads: the
    // run's prompt replaces that, not the branch the switch never evaluates.
    expect(posts[0].prompt['1'].inputs.on_false).toBe('a cat')
    expect(posts[0].prompt['1'].inputs.switch).toBe(false)
    expect(posts[0].prompt['3'].inputs.text).toBe('the text a Generate Text node would make')
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

describe('a submit is bounded by the request deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const SUBMIT_TIMEOUT_MS = 60_000

  /** A workflow whose only text is the negative prompt. */
  const negativeOnlyWorkflow = {
    nodes: [
      { id: 1, type: 'CLIPTextEncode', widgets_values: ['blurry, deformed'] },
      {
        id: 2,
        type: 'KSampler',
        inputs: [{ name: 'negative', link: 3 }],
        widgets_values: [0, 20, 8, 'euler', 'normal', 1]
      }
    ],
    links: [[3, 1, 0, 2, 1]]
  }

  /** A workflow with no text at all, e.g. an upscaler. */
  const textFreeWorkflow = {
    nodes: [
      {
        id: 1,
        type: 'ComfySwitchNode',
        inputs: [
          { name: 'switch', link: null },
          { name: 'on_false', link: null },
          { name: 'on_true', link: null }
        ],
        widgets_values: [true]
      },
      {
        id: 2,
        type: 'KSampler',
        inputs: [{ name: 'latent_image', link: null }],
        widgets_values: [0, 20, 8, 'euler', 'normal', 1]
      }
    ],
    links: []
  }

  it('runs a workflow that holds no text as it was saved', async () => {
    const posts: Record<string, any>[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(textFreeWorkflow)
      posts.push(JSON.parse(String(init?.body)) as Record<string, any>)
      return respond({ prompt_id: 'pid-1' })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.submit({ ...submitInput, prompt: 'a cat' })

    // Nothing carries the prompt, and nothing carries the run's seed either:
    // with no prompt target there is no node the run owns, so the workflow goes
    // out exactly as it was saved.
    const graph = posts[0].prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(Object.values(graph).some((node) => Object.values(node.inputs).includes('a cat'))).toBe(false)
    expect(graph['2'].inputs.seed).toBe(0)
  })

  it('refuses a workflow whose text it cannot place', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      return respond(negativeOnlyWorkflow)
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    // The only text is the negative prompt, and writing the run's prompt there
    // would replace it: refusing beats generating something else.
    await expect(transport.submit({ ...submitInput, prompt: 'a cat' })).rejects.toThrow(/no_prompt_node/)
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
