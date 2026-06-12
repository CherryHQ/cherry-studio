import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOvmsTransport } from '../ovms/ovmsTransport'

/**
 * Covers the relocated OVMS single-shot request (no `/v1`, no auth header),
 * response parsing (b64_json → data: URL else url), abort and the sync-only
 * transport shape. Mirrors the bespoke `providers/ovms/generate.ts`.
 */
describe('OvmsTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseInput = {
    modelId: 'test-model',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined
  } as const

  it('posts a no-auth JSON body to the non-/v1 generations endpoint', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'http://local/a.png' }] }), { status: 200 }))

    const result = await transport.submit({
      ...baseInput,
      modelId: 'sd',
      prompt: 'a cat',
      providerParams: { model: 'sd', size: '768x768', numInferenceSteps: 8, rngSeed: 7 }
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('http://localhost:8000/images/generations')
    const init = call[1] as RequestInit
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Content-Type'])
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'sd',
      prompt: 'a cat',
      size: '768x768',
      num_inference_steps: 8,
      rng_seed: 7
    })
    expect(result).toEqual({ imageUrls: ['http://local/a.png'] })
  })

  it('defaults size/steps/seed when absent', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: { model: 'sd' } })

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      size: '512x512',
      num_inference_steps: 4,
      rng_seed: 0
    })
  })

  it('parses b64_json into data: URLs (preferred over url)', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }, { url: 'http://local/x.png' }] }), { status: 200 })
    )

    const result = await transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: { model: 'sd' } })
    expect(result).toEqual({ imageUrls: ['data:image/png;base64,QUJD'] })
  })

  it('falls back to url entries when no b64_json present', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: 'http://local/y.png' }] }), { status: 200 })
    )

    const result = await transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: { model: 'sd' } })
    expect(result).toEqual({ imageUrls: ['http://local/y.png'] })
  })

  it('throws the remote error message on a non-ok response', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 500 })
    )

    await expect(
      transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: { model: 'sd' } })
    ).rejects.toThrow('bad model')
  })

  it('forwards the abort signal to fetch', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
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

    const promise = transport.submit({
      ...baseInput,
      modelId: 'sd',
      prompt: 'p',
      providerParams: { model: 'sd' },
      signal: controller.signal
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('does not expose polling for the single-shot path', () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    expect('poll' in transport).toBe(false)
  })
})
