import type { FetchFunction } from '@ai-sdk/provider-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import { getSafeProviderErrorMessage, serializeNestedProviderError } from '@shared/ai/providerError'

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

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

const catchNoImage = async (fetchImpl: FetchFunction): Promise<unknown> => {
  return Promise.resolve(imageModel(fetchImpl).doGenerate(generateOptions('a cat'))).catch((cause: unknown) => cause)
}

const asProviderErrorSource = (error: unknown) => error as { message?: unknown; responseBody?: unknown; data?: unknown }

describe('CherryIN image no-image errors survive provider serialization', () => {
  it('keeps the billing warning for a successfully captured empty HTTP 200 body', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(async () => new Response('', { status: 200 }))
    const error = await catchNoImage(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getSafeProviderErrorMessage(asProviderErrorSource(error))).toContain('may have been billed')
    expect(serializeNestedProviderError(error)).toMatchObject({
      statusCode: 200,
      isRetryable: false,
      message: expect.stringContaining('may have been billed')
    })
  })

  it('keeps the billing warning after provider-error serialization for an HTTP 200 empty-data response', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(async () => jsonResponse({ created: 123, data: [] }))

    const error = await catchNoImage(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // `getSafeProviderErrorMessage` is applied by the main serializers; the message
    // must stay intact instead of being dropped with the embedded JSON container.
    const safe = getSafeProviderErrorMessage(asProviderErrorSource(error))
    expect(safe).toContain('no recognizable image data')
    expect(safe).toContain('may have been billed')
    expect(safe).not.toMatch(/[{[]/)

    const serialized = serializeNestedProviderError(error) as {
      name?: string
      message?: string
      statusCode?: number
    }
    expect(serialized.message).toContain('may have been billed')
    expect(serialized.statusCode).toBe(200)
  })

  it.each([
    { data: [], message: 'Generation completed' },
    { data: [], error: { message: 'No image returned' } },
    { data: [], detail: { error: { message: 'Generation finished' } } }
  ])('keeps the billing warning when the empty response contains upstream text: %j', async (body) => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(async () => jsonResponse(body))
    const error = await catchNoImage(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getSafeProviderErrorMessage(asProviderErrorSource(error))).toContain('may have been billed')
    const serialized = serializeNestedProviderError(error) as {
      message?: string
      statusCode?: number
      isRetryable?: boolean
    }
    expect(serialized.message).toContain('no recognizable image data')
    expect(serialized.message).toContain('retrying starts a new billable generation')
    expect(serialized.statusCode).toBe(200)
    expect(serialized.isRetryable).toBe(false)
  })

  it('keeps the billing warning for a successful response whose parsed body has no images', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockImplementation(async () => jsonResponse({ data: [] }))

    const error = await catchNoImage(fetchMock)

    const safe = getSafeProviderErrorMessage(asProviderErrorSource(error))
    expect(safe).toContain('may have been billed')
    // Sanitized shape diagnostics travel in `data`, never in the user-facing message.
    expect((error as { data?: Record<string, unknown> }).data).toBeDefined()
    expect(safe).not.toMatch(/[{[]/)
  })
})
