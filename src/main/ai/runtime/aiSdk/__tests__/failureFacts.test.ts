import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, generateText, InvalidResponseDataError, RetryError } from 'ai'
import { net } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { customFetch } from '@main/ai/utils/customFetch'
import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyAiSdkFailure } from '../failureFacts'
import { createRetryableWrap } from '../retry/createRetryableWrap'

describe('AI SDK failure classification', () => {
  it.each([401, 402, 403, 404, 413, 429, 503])('keeps provider HTTP %i failures local after retries', (statusCode) => {
    const error = new RetryError({
      message: 'Retries exhausted',
      reason: 'maxRetriesExceeded',
      errors: [
        new APICallError({
          message: 'Request rejected',
          url: 'https://provider.invalid',
          requestBodyValues: {},
          statusCode
        })
      ]
    })
    expect(shouldReportFailure(classifyAiSdkFailure(error))).toBe(false)
  })

  it.each([
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CERT_AUTHORITY_INVALID'
  ])('keeps actual provider transport failures local: %s', async (message) => {
    const original = new Error(message)
    vi.mocked(net.fetch).mockRejectedValueOnce(original)
    const error = await customFetch('https://provider.invalid').catch((error: unknown) => error)
    const failure = classifyAiSdkFailure(
      new RetryError({ message: 'Failed', reason: 'maxRetriesExceeded', errors: [error] })
    )
    expect(failure).toMatchObject({ source: 'environment', kind: 'expected', outcome: 'failed' })
    expect(shouldReportFailure(failure)).toBe(false)
    expect(error).toMatchObject({ cause: original })
    expect(shouldReportFailure(classifyAiSdkFailure(original))).toBe(true)
  })

  it('keeps connection refusal local through the real provider SDK', async () => {
    vi.mocked(net.fetch).mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
    const provider = createOpenAICompatible({ name: 'local', baseURL: 'http://127.0.0.1:12345/v1', fetch: customFetch })
    const error = await generateText({ model: provider('test'), prompt: 'hello', maxRetries: 0 }).catch(
      (error: unknown) => error
    )
    expect(classifyAiSdkFailure(error)).toMatchObject({ source: 'environment', kind: 'expected', reason: 'network' })
  })

  it('does not retry a non-retryable HTTP 401 or leave a retry countdown', async () => {
    vi.mocked(net.fetch)
      .mockClear()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: { message: 'invalid_api_key', type: 'authentication_error' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          })
      )
    const provider = createOpenAICompatible({ name: 'local', baseURL: 'http://127.0.0.1:12345/v1', fetch: customFetch })
    const events: string[] = []
    const wrap = createRetryableWrap({
      fallbacks: [],
      retryPolicy: { enabled: true, maxAttempts: 10, backoffEnabled: true, fallbackModelIds: [] },
      onRetryEvent: (event) => events.push(event.state)
    })!
    const error = await generateText({ model: wrap(provider('test')), prompt: 'hello', maxRetries: 0 }).catch(
      (error: unknown) => error
    )
    expect(classifyAiSdkFailure(error)).toMatchObject({ kind: 'expected', reason: 'auth' })
    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(events).not.toContain('retrying')
    vi.mocked(net.fetch).mockReset()
  })

  it('preserves cancellation and programming errors at the fetch boundary', async () => {
    for (const error of [
      new DOMException('Cancelled', 'AbortError'),
      new TypeError('Invalid headers'),
      new Error('Unexpected adapter failure')
    ]) {
      vi.mocked(net.fetch).mockRejectedValueOnce(error)
      await expect(customFetch('https://provider.invalid')).rejects.toBe(error)
    }
  })

  it('retains invalid requests and response parsing failures for investigation', () => {
    const badRequest = new APICallError({
      message: 'Malformed request',
      url: 'https://provider.invalid',
      requestBodyValues: {},
      statusCode: 400
    })
    const invalidResponse = new InvalidResponseDataError({ data: {}, message: 'Response missing a finish reason' })
    expect(shouldReportFailure(classifyAiSdkFailure(badRequest))).toBe(true)
    expect(classifyAiSdkFailure(invalidResponse)).toMatchObject({ kind: 'reliability', reason: 'invalid_response' })
  })

  it('does not mistake application bugs for provider failures from their text or causes', () => {
    const error = new TypeError('Network auth quota error', { cause: new DOMException('Cancelled', 'AbortError') })
    expect(classifyAiSdkFailure(error).kind).toBe('defect')
    expect(shouldReportFailure(classifyAiSdkFailure(new Error('network failure')))).toBe(true)
    expect(shouldReportFailure(classifyAiSdkFailure(new DOMException('Cancelled', 'AbortError')))).toBe(false)
  })
})
