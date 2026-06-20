import { NoSuchToolError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  isSerializedAiSdkAPICallError,
  isSerializedAiSdkNoSuchToolError,
  isSerializedAiSdkRetryError,
  serializeError
} from '../error'

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
      expect(isSerializedAiSdkAPICallError(result)).toBe(true)
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
    it('serializes a RetryError with its discriminant fields so the type guard matches', () => {
      const retryError = new RetryError({
        message: 'retry failed',
        reason: 'maxRetriesExceeded',
        errors: [new Error('attempt 1'), new Error('attempt 2')]
      })

      const result = serializeError(retryError)

      expect(isSerializedAiSdkRetryError(result)).toBe(true)
      expect(result.reason).toBe('maxRetriesExceeded')
      expect(Array.isArray(result.errors)).toBe(true)
      expect((result.errors as unknown[]).length).toBe(2)
      // lastError is also carried.
      expect('lastError' in result).toBe(true)
    })

    it('serializes a NoSuchToolError with its discriminant fields so the type guard matches', () => {
      const noSuchTool = new NoSuchToolError({
        toolName: 'missing_tool',
        availableTools: ['alpha', 'beta']
      })

      const result = serializeError(noSuchTool)

      expect(isSerializedAiSdkNoSuchToolError(result)).toBe(true)
      expect(result.toolName).toBe('missing_tool')
      expect(result.availableTools).toEqual(['alpha', 'beta'])
    })
  })
})
