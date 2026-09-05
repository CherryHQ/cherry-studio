import { aiStreamAdmissionReasons } from '@shared/ai/transport'
import { aiErrorCodes, aiErrorDetail } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { describe, expect, it, vi } from 'vitest'

import {
  formatErrorMessage,
  formatErrorMessageWithPrefix,
  getErrorDetails,
  getErrorMessage,
  isAbortError,
  isTimeoutError,
  providerErrorText,
  serializeHealthCheckError
} from '../error'

vi.mock('i18next', () => ({ t: (key: string) => key }))

describe('error', () => {
  it('maps stream admission reasons to renderer i18n without the generic error prefix', () => {
    const error = new IpcError(aiErrorCodes.AI_STREAM_ADMISSION_REJECTED, 'reason-code', {
      reason: aiStreamAdmissionReasons.MODEL_ALREADY_IN_LIVE_GROUP
    })

    expect(getErrorMessage(error)).toBe('message.error.stream_admission.model_already_in_live_group')
    expect(formatErrorMessageWithPrefix(error, 'Unknown error')).toBe(
      'message.error.stream_admission.model_already_in_live_group'
    )
  })

  describe('getErrorDetails', () => {
    it('should handle null or non-object values', () => {
      expect(getErrorDetails(null)).toBeNull()
      expect(getErrorDetails('string error')).toBe('string error')
      expect(getErrorDetails(123)).toBe(123)
    })

    it('should handle circular references', () => {
      const circularObj: any = {}
      circularObj.self = circularObj

      const result = getErrorDetails(circularObj)
      expect(result).toEqual({ self: circularObj })
    })

    it('should extract properties from Error objects', () => {
      const error = new Error('Test error')
      const result = getErrorDetails(error)

      expect(result.message).toBe('Test error')
      expect(result.stack).toBeDefined()
    })

    it('should skip function properties', () => {
      const objWithFunction = {
        prop: 'value',
        func: () => 'function'
      }

      const result = getErrorDetails(objWithFunction)
      expect(result.prop).toBe('value')
      expect(result.func).toBeUndefined()
    })

    it('should handle nested objects', () => {
      const nestedError = {
        message: 'Outer error',
        cause: new Error('Inner error')
      }

      const result = getErrorDetails(nestedError)
      expect(result.message).toBe('Outer error')
      expect(result.cause.message).toBe('Inner error')
    })
  })

  describe('formatErrorMessage', () => {
    it('should format error with message directly when message exists', () => {
      console.error = vi.fn()

      const error = new Error('Test error')
      const result = formatErrorMessage(error)

      // When error has a message property, it returns the message directly
      expect(result).toBe('Test error')
    })

    it('should return message directly when error object has message property', () => {
      console.error = vi.fn()

      const error = {
        message: 'API error',
        headers: { Authorization: 'Bearer token' },
        stack: 'Error stack trace',
        request_id: '12345'
      }

      const result = formatErrorMessage(error)

      // When error has a message property, it returns the message directly
      expect(result).toBe('API error')
    })

    it('should handle errors during formatting and return placeholder message', () => {
      console.error = vi.fn()

      const problematicError = {
        get message() {
          throw new Error('Cannot access')
        }
      }

      const result = formatErrorMessage(problematicError)
      // When message property throws error, it's caught and set to '<Unable to access property>'
      expect(result).toBe('<Unable to access property>')
    })

    it('should format error object without message property with full details', () => {
      console.error = vi.fn()

      const errorWithoutMessage = {
        code: 500,
        status: 'Internal Server Error'
      }

      const result = formatErrorMessage(errorWithoutMessage)
      // When no message property exists, it returns full error details
      expect(result).toContain('Error Details:')
      expect(result).toContain('"code": 500')
      expect(result).toContain('"status": "Internal Server Error"')
    })
  })

  describe('aiErrorDetail', () => {
    const providerDetail = {
      name: 'AI_APICallError',
      message: '401 Unauthorized',
      stack: null,
      statusCode: 401,
      responseBody: 'invalid api key'
    }

    it('recovers the serialized provider detail from an AI_REQUEST_FAILED IpcError', () => {
      const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '401 Unauthorized', providerDetail)
      expect(aiErrorDetail(err)).toBe(providerDetail)
    })

    it('returns undefined for a plain Error', () => {
      expect(aiErrorDetail(new Error('boom'))).toBeUndefined()
    })

    it('returns undefined for an IpcError with a different code (no mislabeling of sibling IpcErrors)', () => {
      const err = new IpcError('VALIDATION_FAILED', 'bad input', { issues: [] })
      expect(aiErrorDetail(err)).toBeUndefined()
    })
  })

  describe('serializeHealthCheckError', () => {
    it('preserves plain Error message instead of stringifying to an empty object', () => {
      const error = new Error('Health check failed')
      const result = serializeHealthCheckError(error)

      expect(result).toMatchObject({
        name: 'Error',
        message: 'Health check failed'
      })
      expect(result.message).not.toBe('{}')
    })

    it('recovers the rich provider detail (status/body) from an AI_REQUEST_FAILED IpcError', () => {
      const detail = {
        name: 'AI_APICallError',
        message: '500 upstream error',
        stack: null,
        statusCode: 500,
        responseBody: 'upstream exploded'
      }
      const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '500 upstream error', detail)

      const result = serializeHealthCheckError(err)

      // The exact behaviour the migration delivers: rich `data`, not the flattened `message`.
      expect(result).toBe(detail)
      expect(result).toMatchObject({ statusCode: 500, responseBody: 'upstream exploded' })
    })

    it('falls through to message for an IpcError with a different code (does not leak its data)', () => {
      const err = new IpcError('VALIDATION_FAILED', 'bad input', { issues: ['x'] })

      const result = serializeHealthCheckError(err)

      expect(result).toMatchObject({ name: 'IpcError', message: 'bad input' })
      // The wrong-code discriminator must not surface the sibling IpcError's `data`.
      expect((result as Record<string, unknown>).issues).toBeUndefined()
    })
  })

  describe('isAbortError', () => {
    it('should identify OpenAI abort errors by message', () => {
      const openaiError = { message: 'Request was aborted.' }
      expect(isAbortError(openaiError)).toBe(true)
    })

    it('should identify DOM AbortError', () => {
      const domError = new DOMException('The operation was aborted', 'AbortError')
      expect(isAbortError(domError)).toBe(true)
    })

    it('should identify aborted signal errors', () => {
      const signalError = { message: 'The operation was aborted because signal is aborted without reason' }
      expect(isAbortError(signalError)).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isAbortError(new Error('Generic error'))).toBe(false)
      expect(isAbortError({ message: 'Not an abort error' })).toBe(false)
      expect(isAbortError('String error')).toBe(false)
      expect(isAbortError(null)).toBe(false)
    })

    it('should return false for timeout errors', () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError')
      expect(isAbortError(timeoutError)).toBe(false)
    })
  })

  describe('isTimeoutError', () => {
    it('should identify DOM TimeoutError', () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError')
      expect(isTimeoutError(timeoutError)).toBe(true)
    })

    it('should identify timeout errors wrapped in error.cause', () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError')
      const wrappedError = new Error('Wrapped error') as Error & { cause: unknown }
      wrappedError.cause = timeoutError
      expect(isTimeoutError(wrappedError)).toBe(true)
    })

    it('should return false for AbortError', () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      expect(isTimeoutError(abortError)).toBe(false)
    })

    it('should return false for generic errors', () => {
      expect(isTimeoutError(new Error('Generic error'))).toBe(false)
      expect(isTimeoutError({ message: 'Not a timeout error' })).toBe(false)
      expect(isTimeoutError('String error')).toBe(false)
      expect(isTimeoutError(null)).toBe(false)
    })

    it('should return false when error.cause is not a TimeoutError', () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      const wrappedError = new Error('Wrapped error') as Error & { cause: unknown }
      wrappedError.cause = abortError
      expect(isTimeoutError(wrappedError)).toBe(false)
    })
  })

  describe('providerErrorText', () => {
    // AI SDK degrades `message` to the HTTP statusText when the body does not match the
    // provider's error schema; the real reason only survives in `responseBody`.
    it('prefers a non-OpenAI-shaped body over the degraded message', () => {
      expect(
        providerErrorText({
          name: 'AI_APICallError',
          message: 'Forbidden',
          stack: null,
          statusCode: 403,
          responseBody: '{"detail":"Chute not available on your plan"}'
        })
      ).toBe('Chute not available on your plan')
    })

    it.each([
      [400, '{"detail":{"message":"invalid model id"}}', 'invalid model id'],
      [429, '{"error":{"message":"concurrency limit reached"}}', 'concurrency limit reached'],
      [502, '{"message":"upstream service unavailable"}', 'upstream service unavailable']
    ])('extracts the provider message from an HTTP %s response', (statusCode, responseBody, expected) => {
      expect(
        providerErrorText({
          name: 'AI_APICallError',
          message: null,
          stack: null,
          statusCode,
          responseBody
        })
      ).toBe(expected)
    })

    it('extracts the final provider message from a retry error', () => {
      expect(
        providerErrorText({
          name: 'AI_RetryError',
          message: 'Failed after retries. Last error:',
          stack: null,
          cause: null,
          reason: 'maxRetriesExceeded',
          lastError: {
            name: 'AI_APICallError',
            statusCode: 429,
            responseBody: '{"error":{"message":"concurrency limit reached"}}'
          },
          errors: []
        })
      ).toBe('concurrency limit reached')
    })

    it('uses the newest retry attempt when lastError is absent', () => {
      expect(
        providerErrorText({
          name: 'AI_RetryError',
          message: 'Failed after retries. Last error:',
          stack: null,
          cause: null,
          reason: 'maxRetriesExceeded',
          lastError: null,
          errors: [
            { statusCode: 400, responseBody: '{"error":{"message":"older invalid request"}}' },
            { statusCode: 502, responseBody: '{"error":{"message":"latest upstream failure"}}' }
          ]
        })
      ).toBe('latest upstream failure')
    })

    it('extracts structured provider data when the response body is absent', () => {
      expect(
        providerErrorText({
          name: 'AI_APICallError',
          message: null,
          stack: null,
          statusCode: 400,
          responseBody: null,
          data: { error: { message: 'invalid model id' } }
        })
      ).toBe('invalid model id')
    })

    it('does not display unknown fields from a structured provider body', () => {
      expect(
        providerErrorText({
          name: 'AI_APICallError',
          message: 'Forbidden',
          stack: null,
          responseBody: '{"token":"secret","internal":"trace"}'
        })
      ).toBe('Forbidden')
    })

    it('does not display an unstructured provider body', () => {
      expect(
        providerErrorText({ name: 'AI_APICallError', message: 'Forbidden', stack: null, responseBody: '<html>nope' })
      ).toBe('Forbidden')
    })

    it('redacts credentials from an extracted provider message', () => {
      expect(
        providerErrorText({
          name: 'AI_APICallError',
          message: null,
          stack: null,
          responseBody: '{"error":{"message":"Authorization: Bearer sk-provider-secret"}}'
        })
      ).toBe('Authorization: "<redacted>"')
    })

    it('falls back to message when there is no body', () => {
      expect(providerErrorText({ name: 'Error', message: 'boom', stack: null })).toBe('boom')
      expect(providerErrorText(undefined)).toBe('')
    })

    it('truncates an oversized provider message', () => {
      const responseBody = JSON.stringify({ error: { message: 'x'.repeat(600) } })
      const result = providerErrorText({ name: 'Error', message: null, stack: null, responseBody })
      expect(result).toHaveLength(501)
      expect(result.endsWith('\u2026')).toBe(true)
    })
  })
})
