import type { FetchFunction } from '@ai-sdk/provider-utils'
import { generateImage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII='

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
    const payload = PNG_BASE64
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64_json: payload }] })))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    'The image generation could not be completed because the upstream service is temporarily unavailable please try again later now',
    'a'.repeat(200),
    'data:image/png;charset=utf8,%89PNG',
    'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
    'data:image/png;base64,' + btoa('not image bytes'.repeat(20)),
    'iVBORw0KGgo!' + 'A'.repeat(200)
  ])('rejects recovered diagnostic or unsupported image encoding without losing billing context: %s', async (value) => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ results: [{ result: value }] })))
    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )
    expect((error as Error).message).toMatch('no recognizable image data')
    expect((error as Error).message).toMatch(/charg|bill/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([PNG_BASE64, 'data:image/png;base64,' + PNG_BASE64, 'data:image/png;charset=utf8;base64,' + PNG_BASE64])(
    'recovers recognizable image bytes: %s',
    async (value) => {
      const fetchMock = vi
        .fn<FetchFunction>()
        .mockImplementation(fetchReturning(() => jsonResponse({ results: [{ result: value }] })))
      const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))
      expect(result.images).toEqual([value])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each(
    [
      [255, 216, 255, 224],
      [...new TextEncoder().encode('GIF89a')],
      [...new TextEncoder().encode('RIFF1234WEBP')],
      [73, 73, 42, 0],
      [77, 77, 0, 42],
      [...new TextEncoder().encode('BM')],
      [0, 0, 1, 0],
      [0, 0, 0, 24, ...new TextEncoder().encode('ftypavif')]
    ].map((signature) => [signature])
  )('recognizes supported raster signature %j', async (signature) => {
    const payload = btoa(String.fromCharCode(...signature, ...new Array(100).fill(0)))
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ results: [{ result: payload }] })))
    expect((await imageModel(fetchMock).doGenerate(generateOptions('a cat'))).images).toEqual([payload])
  })

  it.each(['DATA:image/png;base64,', 'data:image/png;base64,'])(
    'canonicalizes recovered URI for real SDK consumption: %s',
    async (prefix) => {
      const payload = PNG_BASE64.slice(0, 20) + '\u00a0' + PNG_BASE64.slice(20)
      const fetchMock = vi
        .fn<FetchFunction>()
        .mockImplementation(fetchReturning(() => jsonResponse({ results: [{ result: prefix + payload }] })))
      const result = await generateImage({ model: imageModel(fetchMock), prompt: 'a cat', maxRetries: 0 })
      expect(result.image.base64).toBe(PNG_BASE64)
      expect(result.image.uint8Array.slice(0, 8)).toEqual(PNG_BYTES)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

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
    const payload = PNG_BASE64
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
    const payload = 'iVBORw0KGgoA' + 'A'.repeat(499_988)
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
    const payload = PNG_BASE64
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ data: [{ base64_json: payload }] }, 201)))

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps delegate warnings on the recovered empty-data path', async () => {
    const payload = PNG_BASE64
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
    const payload = PNG_BASE64
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

  it('mirrors per-image token details from usage.input_tokens_details across recovered images', async () => {
    const payload = PNG_BASE64
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(
      fetchReturning(() =>
        jsonResponse({
          created: 1700000000,
          data: [
            { base64_json: payload },
            { base64_json: payload },
            { base64_json: payload },
            { base64_json: payload }
          ],
          usage: {
            input_tokens: 23,
            output_tokens: 4,
            total_tokens: 27,
            input_tokens_details: { image_tokens: 10, text_tokens: 9 }
          }
        })
      )
    )

    const result = await imageModel(fetchMock).doGenerate({ ...generateOptions('four cats'), n: 4 })

    expect(result.images).toHaveLength(4)
    expect(result.usage).toMatchObject({ inputTokens: 23, outputTokens: 4, totalTokens: 27 })
    const images = result.providerMetadata?.openai?.images as Array<Record<string, number>>
    expect(images.map((item) => item.imageTokens)).toEqual([2, 2, 2, 4])
    expect(images.map((item) => item.textTokens)).toEqual([2, 2, 2, 3])
  })

  it('ignores non-numeric token details instead of polluting recovered metadata', async () => {
    const payload = PNG_BASE64
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(
      fetchReturning(() =>
        jsonResponse({
          data: [{ base64_json: payload }],
          usage: { input_tokens: 3, input_tokens_details: { image_tokens: 'many' } }
        })
      )
    )

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.images).toEqual([payload])
    const images = result.providerMetadata?.openai?.images as Array<Record<string, unknown>>
    expect(images).toHaveLength(1)
    expect('imageTokens' in images[0]).toBe(false)
    expect('textTokens' in images[0]).toBe(false)
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
    // The sanitizer discards messages that contain a brace/bracket container.
    expect((error as Error).message).not.toMatch(/[{[]/)
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
    expect((error as { data?: Record<string, unknown> }).data).toMatchObject({ capture: 'skipped-over-cap' })
    expect((error as { isRetryable?: boolean }).isRetryable).toBe(false)
  })

  it('stops buffering an undeclared oversized body at the capture cap', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(1024 * 1024))
    const totalChunks = 40
    let pulled = 0
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(
      fetchReturning(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (pulled >= totalChunks) return controller.close()
                pulled++
                controller.enqueue(chunk)
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    )

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect((error as Error).message).toMatch('may have been billed')
    expect((error as { data?: Record<string, unknown> }).data).toMatchObject({ capture: 'skipped-over-cap' })
  })

  it('throws the terminal no-image error once instead of re-parsing it as a strict-parser failure', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(fetchReturning(() => jsonResponse({ data: [] })))

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect((error as Error).message).toMatch('no recognizable image data')
    // A re-entered recovery would wrap the first no-image error as the cause of a second one.
    expect((error as { cause?: unknown }).cause).toBeUndefined()
  })

  it('keeps OpenAI image metadata on a leniently recovered image', async () => {
    const payload = PNG_BASE64
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(
      fetchReturning(() =>
        jsonResponse({
          created: 1700000000,
          size: '1024x1024',
          quality: 'high',
          output_format: 'png',
          data: [{ base64_json: payload, revised_prompt: 'a fluffy cat' }]
        })
      )
    )

    const result = await imageModel(fetchMock).doGenerate(generateOptions('a cat'))

    expect(result.providerMetadata?.openai).toEqual({
      images: [
        { revisedPrompt: 'a fluffy cat', created: 1700000000, size: '1024x1024', quality: 'high', outputFormat: 'png' }
      ]
    })
  })

  it('keeps call-setting warnings when recovery follows a strict-parser failure', async () => {
    const url = 'https://cdn.example.com/generated.png'
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(fetchReturning(() => jsonResponse({ images: [{ url }] })))

    const result = await imageModel(fetchMock).doGenerate({ ...generateOptions('a cat'), aspectRatio: '16:9', seed: 1 })

    expect(result.images).toEqual([url])
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'aspectRatio' }),
      { type: 'unsupported', feature: 'seed' }
    ])
  })

  it('drops metadata together with a filtered non-image entry so the two stay aligned', async () => {
    const payload = toB64('kept-image-bytes')
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(
      fetchReturning(() =>
        jsonResponse({
          data: [
            { b64_json: 'data:text/plain,upstream error', revised_prompt: 'dropped' },
            { b64_json: payload, revised_prompt: 'kept' }
          ]
        })
      )
    )

    const result = await imageModel(fetchMock).doGenerate({ ...generateOptions('two cats'), n: 2 })

    expect(result.images).toEqual([payload])
    const images = result.providerMetadata?.openai?.images as Array<{ revisedPrompt?: string }> | undefined
    expect(images).toHaveLength(1)
    expect(images?.[0]?.revisedPrompt).toBe('kept')
  })

  it('reports the actual successful status in the billing-aware error', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(fetchReturning(() => jsonResponse({ data: [] }, 201)))

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect((error as { statusCode?: number }).statusCode).toBe(201)
    expect((error as Error).message).toMatch('HTTP 201')
  })

  it('raises the billing-aware error for an unparsable successful body', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockImplementation(
        fetchReturning(
          () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'application/json' } })
        )
      )

    const error = await Promise.resolve(imageModel(fetchMock).doGenerate(generateOptions('a cat'))).catch(
      (cause: unknown) => cause
    )

    expect((error as Error).message).toMatch('may have been billed')
    expect((error as { data?: Record<string, unknown> }).data).toMatchObject({ capture: 'unparsable' })
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
