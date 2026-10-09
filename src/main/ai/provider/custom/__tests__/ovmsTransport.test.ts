import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOvmsTransport } from '../ovms/ovmsTransport'

// Body/response: https://docs.openvino.ai/2026/model-server/ovms_docs_rest_api_image_generation.html, retrieved 2026-09-09.
// The unversioned endpoint remains a compatibility characterization; the documented /v3 upgrade is separate.
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

  it('does not materialize size, steps, or seed when the prepared request leaves them unset', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ b64_json: 'QUJD' }] }))

    await transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: {} })

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ model: 'sd', prompt: 'p' })
  })

  it('throws the remote error message on a non-ok response', async () => {
    const transport = createOvmsTransport({ baseURL: 'http://localhost:8000' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 500 })
    )

    await expect(transport.submit({ ...baseInput, modelId: 'sd', prompt: 'p', providerParams: {} })).rejects.toThrow(
      'bad model'
    )
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
      providerParams: {},
      signal: controller.signal
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
