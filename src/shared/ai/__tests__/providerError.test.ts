import { APICallError, EmptyResponseBodyError, JSONParseError, RetryError, TypeValidationError } from 'ai'
import { describe, expect, it } from 'vitest'

import type { SerializedError } from '../../types/error'
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

  it.each(['400 null', '429 null'])('rejects status-only SDK wrapper text: %s', (message) => {
    expect(getSafeProviderErrorMessage({ message })).toBe('')
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

describe('Groq service-tier serialization', () => {
  it('freshly classifies actual API and retry errors as permission', () => {
    const body =
      'service_tier auto is not available for this org. You can check your plan at https://console.groq.com/settings/billing/plans, and upgrade to access the required service tier.'
    const error = new APICallError({
      message: 'Bad Request',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({ error: { message: body } }),
      isRetryable: false
    })
    expect.soft(serializeNestedProviderError(error)).toMatchObject({
      message: body,
      statusCode: 400,
      providerErrorCategory: 'permission'
    })
    const retry = new RetryError({ message: 'Failed after 1 attempt', reason: 'maxRetriesExceeded', errors: [error] })
    expect(serializeNestedProviderError(retry)).toMatchObject({
      lastError: { message: body, statusCode: 400, providerErrorCategory: 'permission' },
      errors: [{ message: body, statusCode: 400, providerErrorCategory: 'permission' }]
    })
  })
})

// These cases catch payload echoes and false diagnoses before evidence is discarded.
describe('response processing diagnostics', () => {
  const sentinel = 'SENTINEL_PAYLOAD_9f3'
  const empty = 'Invalid response: empty response body. Retry or switch model.'
  const json = 'Invalid JSON data. Retry or check the provider endpoint and model.'
  const validation = 'Type validation failed: unexpected data structure. Check the provider endpoint and model.'
  const terminated = 'Invalid response: response processing terminated. Retry the turn.'
  const generic =
    'Invalid response: the provider response could not be processed. Retry or check the provider endpoint and model.'
  const jsonError = () => new JSONParseError({ text: sentinel, cause: new Error(sentinel) })
  const validationError = () => new TypeValidationError({ value: { private: sentinel }, cause: new Error(sentinel) })
  const wrapper = (options: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) =>
    new APICallError({
      message: 'Failed to process successful response',
      url: `https://example.invalid/${sentinel}`,
      requestBodyValues: { prompt: sentinel },
      statusCode: 200,
      ...options
    })

  it.each([
    ['empty SDK body', () => wrapper({ cause: new EmptyResponseBodyError({ message: sentinel }) }), empty],
    [
      'empty JSON handler body',
      () => wrapper({ message: 'Invalid JSON response', responseBody: '', cause: jsonError() }),
      empty
    ],
    [
      'whitespace JSON body',
      () => wrapper({ message: 'Invalid JSON response', responseBody: ' ', cause: jsonError() }),
      json
    ],
    ['absent JSON body', () => wrapper({ message: 'Invalid JSON response', cause: jsonError() }), json],
    ['JSON cause', () => wrapper({ cause: jsonError() }), json],
    ['validation cause', () => wrapper({ cause: validationError() }), validation],
    ['terminated reader', () => wrapper({ cause: new TypeError('terminated') }), terminated],
    ['unknown cause', () => wrapper({ cause: new Error(sentinel) }), generic],
    ['no cause', () => wrapper(), generic],
    ['spoofed SDK name', () => wrapper({ cause: { name: 'AI_JSONParseError', text: sentinel } }), generic],
    ['spoofed constructor', () => wrapper({ cause: { constructor: JSONParseError, message: sentinel } }), generic],
    ['spoofed TypeError', () => wrapper({ cause: { name: 'TypeError', message: 'terminated' } }), generic],
    ['different TypeError', () => wrapper({ cause: new TypeError(sentinel) }), generic],
    ['direct JSON error', jsonError, json],
    ['direct validation error', validationError, validation],
    ['direct empty body error', () => new EmptyResponseBodyError({ message: sentinel }), empty]
  ])('%s selects a fixed payload-free description', (_label, error, message) => {
    const serialized = serializeNestedProviderError(error())
    expect(serialized).toMatchObject({ message, providerErrorCategory: 'parse', stack: null, cause: null })
    expect(serialized).not.toHaveProperty('text')
    expect(serialized).not.toHaveProperty('value')
    expect(serialized).not.toHaveProperty('issues')
    expect(JSON.stringify(serialized)).not.toContain(sentinel)
  })

  it.each([undefined, null])('does not treat %s body as empty without evidence', (body) => {
    const error = wrapper({ message: 'Invalid JSON response' })
    Object.assign(error, { responseBody: body })
    expect(serializeNestedProviderError(error)).toMatchObject({ message: generic })
  })

  it('requires SDK identity, successful status and recognised outer wording', () => {
    for (const error of [
      wrapper({ statusCode: 400, cause: jsonError() }),
      wrapper({ statusCode: 300, cause: jsonError() }),
      wrapper({ statusCode: 199, cause: jsonError() }),
      wrapper({ statusCode: Number.NaN, cause: jsonError() }),
      wrapper({ message: 'Some other error', cause: jsonError() }),
      Object.assign(new Error('Failed to process successful response'), { statusCode: 200, cause: jsonError() })
    ])
      expect(serializeNestedProviderError(error)).not.toHaveProperty('message', json)
    for (const statusCode of [200, 201, 299]) {
      expect(serializeNestedProviderError(wrapper({ statusCode, cause: jsonError() }))).toMatchObject({
        message: json,
        statusCode,
        isRetryable: false
      })
    }
  })

  it.each([
    ['auth', { error: { type: 'invalid_api_key' } }],
    ['region', { error: { type: 'unsupported_country' } }],
    ['quota', { error: { type: 'insufficient_quota' } }],
    ['content', { error: { type: 'content_filter' } }],
    ['stream', { error: { type: 'ECONNRESET' } }],
    ['proxy', { error: { message: 'proxy connection failed' } }],
    ['network', { error: { message: 'ENOTFOUND' } }],
    ['server', { error: { message: 'service unavailable' } }]
  ])('retains %s evidence when replacing the wrapper message', (category, data) => {
    expect(serializeNestedProviderError(wrapper({ data, cause: jsonError() }))).toMatchObject({
      message: json,
      providerErrorCategory: category
    })
  })

  it('recognises only bounded Anthropic parser records and preserves server precedence', () => {
    const record = JSON.stringify({ name: 'AI_JSONParseError', text: sentinel, message: sentinel })
    let encoded = record
    for (let i = 0; i < 4; i++) encoded = JSON.stringify(encoded)
    for (const responseBody of [record, JSON.stringify(record), JSON.stringify(JSON.stringify(record))]) {
      expect(serializeNestedProviderError(wrapper({ statusCode: 500, responseBody }))).toMatchObject({
        message: json,
        providerErrorCategory: 'server'
      })
    }
    for (const responseBody of [record + ' '.repeat(16_384), encoded, JSON.stringify({ name: 'AI_JSONParseError' })]) {
      expect(serializeNestedProviderError(wrapper({ statusCode: 500, responseBody }))).not.toHaveProperty(
        'message',
        json
      )
    }
    expect(serializeNestedProviderError(wrapper({ responseBody: record }))).toHaveProperty('message', generic)
  })

  it('keeps the exact message input, output and decode bounds', () => {
    expect(getSafeProviderErrorMessage({ message: 'x'.repeat(16_385) })).toBe('')
    expect(getSafeProviderErrorMessage({ message: 'x'.repeat(16_384) })).toBe('x'.repeat(500) + '…')
    let body = JSON.stringify({ error: { message: 'Useful detail' } })
    for (let i = 0; i < 3; i++) {
      expect(getSafeProviderErrorMessage({ responseBody: body })).toBe('Useful detail')
      body = JSON.stringify(body)
    }
    expect(getSafeProviderErrorMessage({ responseBody: body })).toBe('')
    for (const message of ['null', 'undefined', '[object Object]', '{}', '[]']) {
      expect(getSafeProviderErrorMessage({ message })).toBe('')
    }
    expect(getSafeProviderErrorMessage({ message: 'Authorization: Bearer secret-token' })).not.toContain('secret-token')
  })

  it('bounds nested retry errors to five levels even with cycles', () => {
    const cycle = new RetryError({
      message: 'Retry failed',
      reason: 'maxRetriesExceeded',
      errors: [wrapper({ cause: jsonError() })]
    })
    Object.assign(cycle, { lastError: cycle, errors: [cycle] })
    let serialized = serializeNestedProviderError(cycle) as SerializedError
    for (let depth = 0; depth < 4; depth++) serialized = serialized.lastError as SerializedError
    expect(serialized.lastError).toBeNull()
    expect(serialized.errors).toEqual([null])
    expect(JSON.stringify(serializeNestedProviderError(cycle))).not.toContain(sentinel)
    const causeCycle = wrapper()
    Object.assign(causeCycle, { cause: causeCycle })
    expect(serializeNestedProviderError(causeCycle)).toHaveProperty('message', generic)
  })

  it('does not inspect diagnostic causes beyond the serialization depth budget', () => {
    let error: Error = wrapper({ cause: jsonError() })
    for (let depth = 0; depth < 4; depth++) {
      error = new RetryError({ message: 'Retry failed', reason: 'maxRetriesExceeded', errors: [error] })
    }
    let serialized = serializeNestedProviderError(error) as SerializedError
    for (let depth = 0; depth < 4; depth++) serialized = serialized.lastError as SerializedError
    expect(serialized).toMatchObject({ message: generic, cause: null })
  })
})
