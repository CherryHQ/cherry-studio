import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDmxapiTransport } from '../dmxapi/dmxapiTransport'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))

/**
 * Covers the family-based DMXAPI transport request building (openai-flat
 * fallback, doubao-seedream `responses-string`, wan `responses-messages`,
 * async qwen-image `openai-flat-async`), response parsing, abort and the
 * sync-only transport shape. Native fields (n / size / seed) source from
 * `input.*`; vendor extras flow through `providerParams`.
 */
describe('DmxapiTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseInput = {
    modelId: 'm',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined
  } as const

  it('builds an OpenAI-flat /v1/images/generations request from native input fields', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://img/a.png' }] }), { status: 200 }))

    const result = await transport.submit({
      ...baseInput,
      modelId: 'flux-1',
      prompt: 'a fox',
      n: 2,
      size: '1328x1328',
      providerParams: {}
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/images/generations')
    const init = call[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('DMXAPI/1.0.0 (https://www.dmxapi.com)')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ model: 'flux-1', prompt: 'a fox', n: 2, response_format: 'url', size: '1328x1328' })
    expect(result).toEqual({ imageUrls: ['https://img/a.png'] })
  })

  it('builds a doubao-seedream /v1/responses request carrying size and seed', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ output: [{ content: [{ text: '![](https://img/seed.png)' }] }] }), {
        status: 200
      })
    )

    const result = await transport.submit({
      ...baseInput,
      modelId: 'doubao-seedream-3-0',
      prompt: 'a fox',
      size: '1024x1024',
      seed: 42,
      providerParams: {}
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/responses')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toMatchObject({
      model: 'doubao-seedream-3-0',
      input: 'a fox',
      stream: false,
      size: '1024x1024',
      seed: 42
    })
    expect(result).toEqual({ imageUrls: ['https://img/seed.png'] })
  })

  it('inlines uploaded files as data URLs in the wan /v1/responses messages body', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ output: [{ content: [{ image: 'https://img/w.png' }] }] }), { status: 200 })
      )

    const result = await transport.submit({
      ...baseInput,
      modelId: 'wan2.5',
      prompt: 'a fox',
      files: [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }] as never,
      providerParams: {}
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/responses')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.model).toBe('wan2.5')
    expect(body.input.messages[0].content).toEqual([
      { text: 'a fox' },
      { image: `data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}` }
    ])
    expect(result).toEqual({ imageUrls: ['https://img/w.png'] })
  })

  it('parses the async qwen-image extra.output.results wrapper from /v1/images/generations', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://www.dmxapi.com' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          extra: { output: { results: [{ url: 'https://img/q1.png' }, { url: 'https://img/q2.png' }] } }
        }),
        { status: 200 }
      )
    )

    const result = await transport.submit({
      ...baseInput,
      modelId: 'qwen-image',
      prompt: 'a fox',
      size: '1024x1024',
      providerParams: {}
    })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://www.dmxapi.com/v1/images/generations')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toEqual({ model: 'qwen-image', prompt: 'a fox', n: 1, size: '1024x1024' })
    expect(result).toEqual({ imageUrls: ['https://img/q1.png', 'https://img/q2.png'] })
  })

  it('keeps the seededit-3.0 model on V1 even in edit mode', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token', baseURL: 'https://x.test' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))

    await transport.submit({
      ...baseInput,
      modelId: 'seededit-3.0',
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
      modelId: 'm',
      prompt: 'p',
      providerParams: { model: 'm', n: 1, mode: 'generation' }
    })

    expect(result).toEqual({ imageUrls: ['data:image/png;base64,QUJD', 'https://img/c.png'] })
  })

  it('throws typed REQ_ERROR_TOKEN on 401 and REQ_ERROR_NO_BALANCE on 403', async () => {
    const transport = createDmxapiTransport({ apiKey: 'bad' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(
      transport.submit({
        ...baseInput,
        modelId: 'm',
        prompt: 'p',
        providerParams: { model: 'm', n: 1, mode: 'generation' }
      })
    ).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'REQ_ERROR_TOKEN' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(
      transport.submit({
        ...baseInput,
        modelId: 'm',
        prompt: 'p',
        providerParams: { model: 'm', n: 1, mode: 'generation' }
      })
    ).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'REQ_ERROR_NO_BALANCE' })
  })

  it('throws REMOTE_ERROR with the parsed body message on other non-ok status', async () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
    )
    await expect(
      transport.submit({
        ...baseInput,
        modelId: 'm',
        prompt: 'p',
        providerParams: { model: 'm', n: 1, mode: 'generation' }
      })
    ).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'REMOTE_ERROR', message: 'rate limited' })
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
      modelId: 'm',
      prompt: 'p',
      providerParams: { model: 'm', n: 1, mode: 'generation' },
      signal: controller.signal
    })
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('does not expose polling for the single-shot path', () => {
    const transport = createDmxapiTransport({ apiKey: 'token' })
    expect('poll' in transport).toBe(false)
  })
})
