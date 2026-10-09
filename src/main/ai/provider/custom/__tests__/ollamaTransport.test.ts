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

import { resolveOllamaImageFetch } from '../ollama/ollamaImageFetch'
import { createOllamaTransport } from '../ollama/ollamaTransport'

/**
 * Covers the Ollama single-shot `/api/generate` request — the base model/prompt
 * body, optional width/height/seed/steps, the bare-base64 `image` passthrough
 * (no `data:` URI wrapping — see the transport for why), custom headers, abort,
 * and the sync-only transport shape. Mirrors `ovmsTransport.test.ts`.
 * Ollama does not publish this image extension contract; these are current
 * behavior characterization tests, retrieved from the existing path 2026-07-27.
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
    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      fetch: resolveOllamaImageFetch(undefined)
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ image: 'QUJD' }), { status: 200 }))

    const result = await transport.submit({ ...baseInput, prompt: 'a cat' })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('http://localhost:11434/api/generate')
    const init = call[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ model: 'x/z-image-turbo', prompt: 'a cat', stream: false })
    expect(result).toEqual({ kind: 'completed', imageUrls: ['QUJD'] })
  })

  it('constructs an Agent dispatcher with a timeout well past undici defaults, so a cold model load does not trip "fetch failed"', async () => {
    const options = getConstructedOptions() as { headersTimeout: number; bodyTimeout: number }
    // undici default is 300_000ms; cold-loading a multi-GB model routinely exceeds it.
    expect(options.headersTimeout).toBeGreaterThan(300_000)
    expect(options.bodyTimeout).toBeGreaterThan(300_000)

    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      fetch: resolveOllamaImageFetch(undefined)
    })
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

  it('rejects a successful response with no image field', async () => {
    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      fetch: resolveOllamaImageFetch(undefined)
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

    await expect(transport.submit({ ...baseInput, prompt: 'a cat' })).rejects.toThrow('Invalid JSON response')
  })

  it('throws the remote error message on a non-ok response', async () => {
    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      fetch: resolveOllamaImageFetch(undefined)
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), { status: 404 })
    )

    await expect(transport.submit({ ...baseInput, prompt: 'a cat' })).rejects.toThrow('model not found')
  })

  it('forwards the abort signal to fetch', async () => {
    const transport = createOllamaTransport({
      baseURL: 'http://localhost:11434/api',
      fetch: resolveOllamaImageFetch(undefined)
    })
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
})
