import { afterEach, describe, expect, it, vi } from 'vitest'

// Plain closure, not vi.fn() — the real Agent is a module-level singleton
// constructed exactly once at import time, before any test's `afterEach`
// (which clears vi.fn() mock-call history) has a chance to run.
const { MockAgent, getConstructedOptions } = vi.hoisted(() => {
  let constructedOptions: unknown
  class MockAgent {
    constructor(options: unknown) {
      constructedOptions = options
    }
  }
  return { MockAgent, getConstructedOptions: () => constructedOptions }
})

vi.mock('undici', () => ({ Agent: MockAgent }))

import { createOllamaTransport } from '../ollama/ollamaTransport'

/**
 * Covers the Ollama single-shot `/api/generate` request — the base model/prompt
 * body, optional width/height/seed/steps, the bare-base64 `image` passthrough
 * (no `data:` URI wrapping — see the transport for why), custom headers, abort,
 * and the sync-only transport shape. Mirrors `ovmsTransport.test.ts`.
 */
describe('OllamaTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseInput = {
    modelId: 'x/z-image-turbo',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerParams: {}
  } as const

  it('posts a minimal JSON body to /generate', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    const result = await transport.submit({ ...baseInput, prompt: 'a cat' })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('http://localhost:11434/api/generate')
    const init = call[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ model: 'x/z-image-turbo', prompt: 'a cat', stream: false })
    expect(result).toEqual({ imageUrls: ['QUJD'] })
  })

  it('splits size into width/height and forwards seed and providerParams.steps', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      prompt: 'a cat',
      size: '768x768',
      seed: 42,
      providerParams: { steps: 9 }
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'x/z-image-turbo',
      prompt: 'a cat',
      stream: false,
      width: 768,
      height: 768,
      seed: 42,
      steps: 9
    })
  })

  it('ignores a non-numeric providerParams.steps', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    await transport.submit({ ...baseInput, prompt: 'a cat', providerParams: { steps: 'nine' } })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ model: 'x/z-image-turbo', prompt: 'a cat', stream: false })
  })

  it('constructs an Agent dispatcher with a timeout well past undici defaults, so a cold model load does not trip "fetch failed"', async () => {
    const options = getConstructedOptions() as { headersTimeout: number; bodyTimeout: number }
    // undici default is 300_000ms; cold-loading a multi-GB model routinely exceeds it.
    expect(options.headersTimeout).toBeGreaterThan(300_000)
    expect(options.bodyTimeout).toBeGreaterThan(300_000)

    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    await transport.submit({ ...baseInput, prompt: 'a cat' })

    const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher: unknown }
    expect(init.dispatcher).toBeInstanceOf(MockAgent)
  })

  it('prefers an injected fetch (e.g. the proxy-aware customFetch) over global fetch, and skips the dispatcher', async () => {
    const injectedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch')
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api', fetch: injectedFetch })

    await transport.submit({ ...baseInput, prompt: 'a cat' })

    expect(injectedFetch).toHaveBeenCalledTimes(1)
    expect(globalFetchSpy).not.toHaveBeenCalled()
    const init = injectedFetch.mock.calls[0][1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBeUndefined()
  })

  it('falls back to global fetch with the long-timeout dispatcher when no fetch is injected', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    await transport.submit({ ...baseInput, prompt: 'a cat' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBeInstanceOf(MockAgent)
  })

  it('merges custom headers with Content-Type', async () => {
    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      headers: { Authorization: 'Bearer token' }
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    await transport.submit({ ...baseInput, prompt: 'a cat' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token' })
  })

  it('does not wrap the base64 image in a data: URI (the patched ai SDK only auto-downloads http(s) URLs; anything else is decoded as raw base64 verbatim)', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ image: 'aGVsbG8=' }), { status: 200 })
    )

    const result = await transport.submit({ ...baseInput, prompt: 'a cat' })
    expect(result.imageUrls?.[0]).not.toMatch(/^data:/)
    expect(result).toEqual({ imageUrls: ['aGVsbG8='] })
  })

  it('returns no images when the response has no image field', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

    const result = await transport.submit({ ...baseInput, prompt: 'a cat' })
    expect(result).toEqual({ imageUrls: [] })
  })

  it('throws the remote error message on a non-ok response', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), { status: 404 })
    )

    await expect(transport.submit({ ...baseInput, prompt: 'a cat' })).rejects.toThrow('model not found')
  })

  it('forwards the abort signal to fetch', async () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        ;(init?.signal as AbortSignal)?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })

    const promise = transport.submit({ ...baseInput, prompt: 'a cat', signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('does not expose polling for the single-shot path', () => {
    const transport = createOllamaTransport({ baseURL: 'http://localhost:11434/api' })
    expect('poll' in transport).toBe(false)
  })
})
