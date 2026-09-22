import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import { getSafeProviderErrorMessage, serializeNestedProviderError } from '../providerError'

const PROVIDER_TEXT_FIELDS = [
  ['message', (value: string) => ({ message: value })],
  ['msg', (value: string) => ({ msg: value })],
  ['error.message', (value: string) => ({ error: { message: value } })],
  ['detail.message', (value: string) => ({ detail: { message: value } })],
  ['detail.error.message', (value: string) => ({ detail: { error: { message: value } } })],
  ['detail', (value: string) => ({ detail: value })],
  ['error', (value: string) => ({ error: value })]
] as const

describe('getSafeProviderErrorMessage', () => {
  it.each(PROVIDER_TEXT_FIELDS)(
    'rejects closed unquoted and numeric-leading containers in %s',
    (_field, payloadFor) => {
      for (const text of [
        'Provider failed: [private prompt, internal trace]',
        'Provider failed: [123, private prompt]',
        'Provider failed: [123, "private prompt"]',
        'Provider failed: [123,\nprivate prompt]',
        'Provider failed: {123: private prompt}',
        'Provider failed: {-1.5: private prompt}'
      ]) {
        for (const encoded of [text, JSON.stringify(text)]) {
          expect(getSafeProviderErrorMessage({ message: encoded })).toBe('')
          expect(
            getSafeProviderErrorMessage({ message: 'Bad Request', responseBody: JSON.stringify(payloadFor(encoded)) })
          ).toBe('Bad Request')
          expect(getSafeProviderErrorMessage({ message: 'Bad Request', data: payloadFor(encoded) })).toBe('Bad Request')
        }
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)('rejects multiline truncated arrays in %s', (_field, payloadFor) => {
    for (const newline of ['\n', '\r\n', '\r']) {
      const text = `Provider failed: [private prompt,${newline}internal trace`
      for (const encoded of [text, JSON.stringify(text)]) {
        expect(
          getSafeProviderErrorMessage({ message: 'Bad Request', responseBody: JSON.stringify(payloadFor(encoded)) })
        ).toBe('Bad Request')
        expect(getSafeProviderErrorMessage({ message: encoded })).toBe('')
      }
    }
  })

  it.each(PROVIDER_TEXT_FIELDS)('ignores direct and repeatedly encoded JSON containers in %s', (_field, payloadFor) => {
    const privatePayloads = [
      JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' }),
      JSON.stringify([{ prompt: 'private user prompt' }])
    ].flatMap((value) => [value, JSON.stringify(value)])

    for (const privatePayload of privatePayloads) {
      const message = getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify(payloadFor(privatePayload))
      })

      expect(message).toBe('Bad Request')
      expect(message).not.toMatch(/private user prompt|internal trace/)
    }
  })

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores direct and repeatedly encoded malformed objects in %s',
    (_field, payloadFor) => {
      const malformed = '{"prompt":"private user prompt","trace":"internal trace"'

      for (const privatePayload of [malformed, JSON.stringify(malformed)]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores direct and repeatedly encoded malformed quote-prefixed containers in %s',
    (_field, payloadFor) => {
      const malformed = `"${JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })}`

      for (const privatePayload of [malformed, JSON.stringify(malformed)]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores malformed single-quoted and escaped-quote containers in %s',
    (_field, payloadFor) => {
      const privateObject = JSON.stringify({ prompt: 'private user prompt', trace: 'internal trace' })

      for (const privatePayload of [`'${privateObject}`, `\\"${privateObject}`]) {
        const message = getSafeProviderErrorMessage({
          message: 'Bad Request',
          responseBody: JSON.stringify(payloadFor(privatePayload))
        })

        expect(message).toBe('Bad Request')
        expect(message).not.toMatch(/private user prompt|internal trace/)
      }
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)(
    'ignores malformed containers after arbitrary provider prefixes in %s',
    (_field, payloadFor) => {
      const malformed = 'Provider failed: {"prompt":"private user prompt","trace":"internal trace"'
      const message = getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify(payloadFor(malformed))
      })

      expect(message).toBe('Bad Request')
      expect(message).not.toMatch(/private user prompt|internal trace/)
    }
  )

  it.each(PROVIDER_TEXT_FIELDS)('ignores malformed unquoted objects and scalar arrays in %s', (_field, payloadFor) => {
    for (const privatePayload of [
      'Provider failed: {prompt:"private user prompt",trace:"internal trace"',
      'Provider failed: [400, "private user prompt"',
      'Provider failed: [private user prompt, internal trace',
      'Provider failed: [private user prompt'
    ]) {
      const message = getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify(payloadFor(privatePayload))
      })

      expect(message).toBe('Bad Request')
      expect(message).not.toMatch(/private user prompt|internal trace/)
    }
  })

  it.each(PROVIDER_TEXT_FIELDS)('ignores HTML documents in %s', (_field, payloadFor) => {
    for (const privatePayload of [
      '<!doctype html><html><body>private user prompt</body></html>',
      '<html><body>internal trace</body></html>',
      'Provider failed: <!doctype html><html><body>private user prompt</body></html>',
      'Upstream response: <html><body>internal trace</body></html>'
    ]) {
      const message = getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify(payloadFor(privatePayload))
      })

      expect(message).toBe('Bad Request')
      expect(message).not.toMatch(/private user prompt|internal trace/)
    }
  })

  it('ignores an oversized provider payload before decoding it', () => {
    const message = getSafeProviderErrorMessage({
      message: 'Bad Request',
      responseBody: JSON.stringify({ detail: 'x'.repeat(1_000_000) })
    })

    expect(message).toBe('Bad Request')
  })

  it('ignores provider text nested beyond the supported decode depth', () => {
    let deeplyEncoded = 'Service temporarily unavailable'
    for (let depth = 0; depth < 8; depth += 1) deeplyEncoded = JSON.stringify(deeplyEncoded)

    expect(
      getSafeProviderErrorMessage({
        message: 'Bad Request',
        responseBody: JSON.stringify({ detail: deeplyEncoded })
      })
    ).toBe('Bad Request')
  })

  it.each(PROVIDER_TEXT_FIELDS)('keeps normal provider text in %s', (_field, payloadFor) => {
    expect(
      getSafeProviderErrorMessage({ responseBody: JSON.stringify(payloadFor('Service temporarily unavailable')) })
    ).toBe('Service temporarily unavailable')
  })

  it.each([
    'Template variable {name} is required',
    'Input [0] must be a string',
    'Input indexes [0,1] must be unique',
    'Input indexes [ 0, 1 ] must be unique'
  ])('keeps ordinary provider text containing braces or brackets: %s', (providerMessage) => {
    expect(getSafeProviderErrorMessage({ responseBody: JSON.stringify({ error: { message: providerMessage } }) })).toBe(
      providerMessage
    )
  })

  it.each(PROVIDER_TEXT_FIELDS)('keeps JSON primitive payload text in %s', (_field, payloadFor) => {
    for (const value of ['"quoted provider message"', '400', 'true']) {
      expect(getSafeProviderErrorMessage({ responseBody: JSON.stringify(payloadFor(value)) })).toBe(value)
    }
  })

  it('preserves the terminal provider error inside a nested RetryError', () => {
    const terminalError = new APICallError({
      message: 'Forbidden',
      url: 'https://api.example.com/chat?token=url-secret',
      requestBodyValues: { prompt: 'private user prompt' },
      statusCode: 429,
      responseHeaders: { 'set-cookie': 'session=header-secret' },
      responseBody: JSON.stringify({ error: { message: 'provider concurrency limit reached' } }),
      data: { apiKey: 'data-secret' },
      isRetryable: true
    })
    const retryError = new RetryError({
      message: 'Nested retry failed',
      reason: 'maxRetriesExceeded',
      errors: [terminalError]
    })

    const serialized = serializeNestedProviderError(retryError)

    expect(serialized).toMatchObject({
      name: 'AI_RetryError',
      reason: 'maxRetriesExceeded',
      lastError: {
        name: 'AI_APICallError',
        message: 'provider concurrency limit reached',
        statusCode: 429,
        isRetryable: true
      }
    })
    expect(serialized).toHaveProperty('errors.0.message', 'provider concurrency limit reached')
    expect(JSON.stringify(serialized)).not.toMatch(/url-secret|private user prompt|header-secret|data-secret/)
  })
})
