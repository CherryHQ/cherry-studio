import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDmxapiTransport } from '../pollingTransports/dmxapi'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => (key === 'paintings.dmxapi.style' ? ', Style: ' : key)
  }
}))

/**
 * Covers the relocated DMXAPI single-shot request building (V1 JSON
 * generations / V2 FormData edits + merge), response parsing, abort and the
 * no-poll guarantee. Mirrors the bespoke `providers/dmxapi/generate.ts`.
 */
describe('DmxapiTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseInput = {
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined
  } as const

  it('builds a V1 JSON generations request with seed -1 sentinel, style_type prepend and extend_params', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://img/a.png' }] }), { status: 200 }))

    const result = await transport.submit({
      ...baseInput,
      prompt: 'a fox',
      providerParams: {
        model: 'flux-1',
        n: 2,
        imageSize: '1328x1328',
        seed: '-5',
        styleType: 'anime',
        mode: 'generation',
        extendParams: { foo: 'bar' }
      }
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/images/generations')
    const init = call[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('DMXAPI/1.0.0 (https://www.dmxapi.com)')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      prompt: 'a fox, Style: anime',
      model: 'flux-1',
      n: 2,
      size: '1328x1328',
      seed: -1,
      foo: 'bar'
    })
    expect(result).toEqual({ imageUrls: ['https://img/a.png'] })
  })

  it('keeps a seed >= -1 verbatim in the V1 request', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      prompt: 'p',
      providerParams: { model: 'm', n: 1, seed: '42', mode: 'generation' }
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.seed).toBe(42)
  })

  it('inlines a single uploaded image as a base64 data URL in V1 generation mode', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      prompt: 'p',
      providerParams: {
        model: 'm',
        n: 1,
        mode: 'generation',
        imageFiles: [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }]
      }
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.image).toBe(`data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`)
  })

  it('builds a V2 FormData edits request with all files appended (multi-image merge)', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://img/b.png' }] }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      prompt: 'merge these',
      providerParams: {
        model: 'flux-1',
        n: 1,
        imageSize: '1024x1024',
        styleType: 'oil',
        mode: 'merge',
        imageFiles: [
          { mediaType: 'image/png', data: new Uint8Array([1]), name: 'a.png' },
          { mediaType: 'image/jpeg', data: new Uint8Array([2]), name: 'b.jpg' }
        ]
      }
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/images/edits')
    const form = (call[1] as RequestInit).body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('prompt')).toBe('merge these style: oil')
    expect(form.get('model')).toBe('flux-1')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.getAll('image')).toHaveLength(2)
  })

  it('keeps the seededit-3.0 model on V1 even in edit mode', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://x.test' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      prompt: 'p',
      providerParams: { model: 'seededit-3.0', n: 1, mode: 'edit' }
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://x.test/v1/images/generations')
  })

  it('parses b64_json into a data: URL and drops empty entries', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }, {}, { url: 'https://img/c.png' }] }), { status: 200 })
    )

    const result = await transport.submit({
      ...baseInput,
      prompt: 'p',
      providerParams: { model: 'm', n: 1, mode: 'generation' }
    })

    expect(result).toEqual({ imageUrls: ['data:image/png;base64,QUJD', 'https://img/c.png'] })
  })

  it('throws a token error on 401 and a balance error on 403', async () => {
    const transport = createDmxapiTransport({ apiKey: 'bad' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(
      transport.submit({ ...baseInput, prompt: 'p', providerParams: { model: 'm', n: 1, mode: 'generation' } })
    ).rejects.toThrow(/invalid token/)

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(
      transport.submit({ ...baseInput, prompt: 'p', providerParams: { model: 'm', n: 1, mode: 'generation' } })
    ).rejects.toThrow(/insufficient balance/)
  })

  it('forwards the abort signal to fetch', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
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
      prompt: 'p',
      providerParams: { model: 'm', n: 1, mode: 'generation' },
      signal: controller.signal
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('poll() throws and is never reached on the single-shot path', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    await expect(transport.poll()).rejects.toThrow(/does not support polling/)
  })
})
