import { APICallError, InvalidResponseDataError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyAiSdkFailure } from '../failureFacts'

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
