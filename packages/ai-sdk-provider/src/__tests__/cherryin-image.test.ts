import type { FetchFunction } from '@ai-sdk/provider-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const toB64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

const jsonResponse = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

const fetchReturning = (respond: () => Response): FetchFunction => {
  const impl = async (): Promise<Response> => respond()
  return impl
}

const imageModel = (fetchImpl: FetchFunction) =>
  createCherryIn({ apiKey: 'test-key', baseURL: 'https://open.cherryin.net/v1', fetch: fetchImpl }).imageModel(
    'openai/gpt-image-2'
  )

const generateOptions = (prompt: string) => ({
  prompt,
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {},
  headers: undefined,
  abortSignal: undefined
})

describe('CherryIN OpenAI image responses', () => {
  it('passes a standard b64_json generation response through', async () => {
    const payload = toB64('hello-image-bytes')
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ b64_json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a gateway base64_json generation response without an extra request', async () => {
    const payload = `${toB64('gateway-image-bytes-')}${'a'.repeat(200)}`
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64_json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a top-level images url response', async () => {
    const url = 'https://cdn.example.com/generated.png'
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ images: [{ url }] })))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([url])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers pixels shadowed by an empty data array', async () => {
    const url = 'https://cdn.example.com/recovered.png'
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [], images: [{ url }] })))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([url])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers an image-edit response sent under an alternate key', async () => {
    const payload = `${toB64('edit-image-bytes-')}${'a'.repeat(200)}`
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ b64Json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate({
      ...generateOptions('edit this image'),
      files: [{ type: 'file', data: PNG_BYTES, mediaType: 'image/png' }]
    })

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/images/edits')
  })

  it('recovers a large image-edit payload', async () => {
    const payload = 'a'.repeat(500_000)
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64Json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate({
      ...generateOptions('edit this image'),
      files: [{ type: 'file', data: PNG_BYTES, mediaType: 'image/png' }]
    })

    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toHaveLength(payload.length)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a 201 response carrying an alternate key', async () => {
    const payload = `${toB64('created-image-bytes-')}${'a'.repeat(200)}`
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64_json: payload }] }, 201)))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps delegate warnings on the recovered empty-data path', async () => {
    const payload = `${toB64('warned-image-bytes-')}${'a'.repeat(200)}`
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64_json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate({
      ...generateOptions('a cat'),
      aspectRatio: '16:9'
    })

    expect(result.images).toEqual([payload])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('maps legacy usage keys on a recovered response', async () => {
    const payload = `${toB64('metered-image-bytes-')}${'a'.repeat(200)}`
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(
        fetchReturning(() =>
          jsonResponse({ data: [{ base64_json: payload }], usage: { prompt_tokens: 7, total_tokens: 9 } })
        )
      )

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(result.usage).toMatchObject({ inputTokens: 7, totalTokens: 9 })
  })

  it('rejects a non-image data URI instead of returning it as pixels', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(
        fetchReturning(() => jsonResponse({ data: [{ b64_json: 'data:text/plain,upstream error' }] }))
      )

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toMatch('no recognizable image data')
  })

  it('throws a non-retryable billing-aware error when a 200 carries no image data', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ created: 123, data: [] })))

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch('no recognizable image data')
    expect((error as Error).message).toMatch('may have been billed')
    expect((error as { isRetryable?: boolean }).isRetryable).toBe(false)
  })

  it('keeps billing context when the body exceeds the capture cap', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(
        fetchReturning(() => jsonResponse({ created: 123, data: [] }, 200, { 'content-length': '25000000' }))
      )

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toMatch('may have been billed')
    expect((error as { isRetryable?: boolean }).isRetryable).toBe(false)
  })

  it('leaves a 504 gateway timeout untouched', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => new Response('gateway timeout', { status: 504 })))

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as { statusCode?: number }).statusCode).toBe(504)
    expect((error as Error).message).not.toMatch('no recognizable image data')
  })
})
