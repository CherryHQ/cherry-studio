import { APICallError, NoSuchToolError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import { serializeError } from '../serializeError'

describe('serializeError', () => {
  describe('null preservation (FIX error-1)', () => {
    it('serializes an absent cause to real null, not the string "null"', () => {
      const result = serializeError(new Error('boom'))

      expect(result.cause).toBeNull()
      expect(result.cause).not.toBe('null')
    })

    it('serializes an absent responseBody to real null, not the string "null"', () => {
      // APICallError-shaped error with statusCode/url/requestBodyValues present but responseBody absent.
      const err = Object.assign(new Error('api boom'), {
        url: 'https://example.com',
        requestBodyValues: { foo: 'bar' },
        statusCode: 500,
        isRetryable: false,
        data: null
      })

      const result = serializeError(err)

      // responseBody key is absent on the source error → not extracted at all.
      expect(result.responseBody).toBeUndefined()
    })

    it('preserves a present responseBody as a string', () => {
      const err = Object.assign(new Error('api boom'), {
        url: 'https://example.com',
        requestBodyValues: { foo: 'bar' },
        statusCode: 500,
        responseBody: '{"error":"bad"}',
        responseHeaders: { 'content-type': 'application/json' },
        isRetryable: true,
        data: { detail: 'x' }
      })

      const result = serializeError(err)

      expect(result.responseBody).toBe('{"error":"bad"}')
      // APICallError discriminant fields are carried through.
      expect(result.url).toBe('https://example.com')
      expect(result.statusCode).toBe(500)
      expect(result.isRetryable).toBe(true)
    })

    it('serializes a present responseBody of null to real null', () => {
      const err = Object.assign(new Error('api boom'), {
        url: 'https://example.com',
        requestBodyValues: {},
        statusCode: 500,
        responseBody: null,
        responseHeaders: null,
        isRetryable: false,
        data: null
      })

      const result = serializeError(err)

      expect(result.responseBody).toBeNull()
      expect(result.responseBody).not.toBe('null')
    })
  })

  describe('discriminant field extraction (FIX error-2)', () => {
    it('preserves a renderer translation key from application errors', () => {
      const error = Object.assign(new Error('fallback message'), {
        i18nKey: 'tool_call_limit_reached'
      })

      expect(serializeError(error).i18nKey).toBe('tool_call_limit_reached')
    })

    it('does not forward an unknown Claude Code exit category', () => {
      const error = Object.assign(new Error('Claude Code process exited'), {
        claudeCodeExitCategory: 'future-category'
      })

      expect(serializeError(error).claudeCodeExitCategory).toBeUndefined()
    })

    it('preserves only safe nested provider details in a RetryError', () => {
      const providerError = new APICallError({
        message: 'Forbidden',
        url: 'https://api.example.com/chat/completions?token=url-secret',
        requestBodyValues: { messages: [{ content: 'private user prompt' }] },
        statusCode: 429,
        responseHeaders: { 'set-cookie': 'session=header-secret' },
        responseBody: JSON.stringify({
          error: { message: 'provider concurrency limit reached' },
          trace: 'response-secret'
        }),
        data: { apiKey: 'data-secret' },
        cause: new Error('Authorization: Bearer cause-secret'),
        isRetryable: true
      })
      const retryError = new RetryError({
        message: 'retry failed',
        reason: 'maxRetriesExceeded',
        errors: [providerError]
      })

      const result = serializeError(retryError)

      expect(result.reason).toBe('maxRetriesExceeded')
      expect(result.lastError).toMatchObject({
        name: 'AI_APICallError',
        message: 'provider concurrency limit reached',
        statusCode: 429,
        isRetryable: true
      })
      expect(result.lastError).not.toHaveProperty('url')
      expect(result.lastError).not.toHaveProperty('requestBodyValues')
      expect(result.lastError).not.toHaveProperty('responseHeaders')
      expect(result.lastError).not.toHaveProperty('responseBody')
      expect(result.lastError).not.toHaveProperty('data')
      expect(result.errors).toEqual([result.lastError])
      expect(JSON.stringify(result)).not.toMatch(
        /url-secret|private user prompt|header-secret|response-secret|data-secret|cause-secret/
      )
    })

    it('redacts a plain nested retry error without serializing its cause or stack', () => {
      const terminalError = new Error('upstream socket closed; Authorization: Bearer message-secret', {
        cause: new Error('Authorization: Bearer cause-secret')
      })
      const retryError = new RetryError({
        message: 'Failed after retries',
        reason: 'maxRetriesExceeded',
        errors: [terminalError]
      })

      const result = serializeError(retryError)

      expect(result.lastError).toEqual({
        name: 'Error',
        message: 'upstream socket closed; Authorization: "<redacted>"',
        stack: null,
        cause: null
      })
      expect(result.errors).toEqual([result.lastError])
      expect(JSON.stringify(result)).not.toMatch(/message-secret|cause-secret/)
    })

    it('drops unknown nested retry values instead of serializing credentials', () => {
      const retryError = new RetryError({
        message: 'Failed after retries',
        reason: 'maxRetriesExceeded',
        errors: [
          'Authorization: Bearer string-secret',
          { apiKey: 'object-secret', nested: { token: 'nested-secret' } }
        ] as unknown as Error[]
      })

      const result = serializeError(retryError)

      expect(result.lastError).toBeNull()
      expect(result.errors).toEqual([null, null])
      expect(JSON.stringify(result)).not.toMatch(/string-secret|object-secret|nested-secret/)
    })

    it('preserves safe discriminants from a nested AI SDK error', () => {
      const terminalError = new NoSuchToolError({
        toolName: 'missing_tool',
        availableTools: ['search', 'calculator']
      })
      const retryError = new RetryError({
        message: 'Failed after retries',
        reason: 'maxRetriesExceeded',
        errors: [terminalError]
      })

      const result = serializeError(retryError)

      expect(result.lastError).toMatchObject({
        name: 'AI_NoSuchToolError',
        toolName: 'missing_tool',
        availableTools: ['search', 'calculator'],
        stack: null,
        cause: null
      })
      expect(result.errors).toEqual([result.lastError])
    })

    it('serializes a NoSuchToolError with its discriminant fields', () => {
      const noSuchTool = new NoSuchToolError({
        toolName: 'missing_tool',
        availableTools: ['alpha', 'beta']
      })

      const result = serializeError(noSuchTool)

      expect(result.toolName).toBe('missing_tool')
      expect(result.availableTools).toEqual(['alpha', 'beta'])
    })
  })
})
