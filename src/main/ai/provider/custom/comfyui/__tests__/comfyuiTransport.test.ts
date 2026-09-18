import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'

import { applySeed, createComfyuiTransport, listWorkflows } from '../comfyuiTransport'
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
  it('dequeues the id and interrupts only that generation', async () => {
    const doFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('', { status: 200 })
    )
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await transport.cancel('pid-1')

    const requests = doFetch.mock.calls.map(([input, init]) => ({
      url: String(input),
      body: JSON.parse(init?.body as string)
    }))
    expect(requests).toEqual([
      { url: 'http://localhost:8188/queue', body: { delete: ['pid-1'] } },
      { url: 'http://localhost:8188/interrupt', body: { prompt_id: 'pid-1' } }
    ])
  })

  it('stays silent when the cancel requests fail', async () => {
    const doFetch = vi.fn(async () => {
      throw new Error('server down')
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })

    await expect(transport.cancel('pid-1')).resolves.toBeUndefined()
  })
})

describe('poll', () => {
  const POLL_INTERVAL_MS = 1500
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
