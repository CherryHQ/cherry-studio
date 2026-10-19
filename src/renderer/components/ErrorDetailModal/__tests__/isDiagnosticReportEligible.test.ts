import { describe, expect, it } from 'vitest'

import type { SerializedError } from '@renderer/types/error'

import { isDiagnosticReportEligible } from '../isDiagnosticReportEligible'

function makeError(overrides: Partial<SerializedError> & Record<string, unknown> = {}): SerializedError {
  return {
    name: 'ProviderError',
    message: 'failed',
    stack: null,
    ...overrides
  }
}

function makeApiCallAttempt(overrides: Partial<SerializedError> = {}): SerializedError {
  return {
    name: 'AI_APICallError',
    message: null,
    stack: null,
    cause: null,
    url: '',
    requestBodyValues: null,
    statusCode: null,
    responseHeaders: null,
    responseBody: null,
    isRetryable: true,
    data: null,
    ...overrides
  }
}

/** ai-retry copies the terminal phrase onto a status-less RetryError and keeps lastError plus errors. */
function makeCopiedRetry(
  phrase: string,
  attempts: SerializedError[],
  wrapper: Partial<SerializedError> = {}
): SerializedError {
  return makeError({
    name: 'AI_RetryError',
    message: `Failed after ${attempts.length} attempts. Last error: ${phrase}`,
    cause: null,
    reason: 'maxRetriesExceeded',
    lastError: attempts[attempts.length - 1],
    errors: attempts,
    ...wrapper
  })
}

describe('isDiagnosticReportEligible', () => {
  it('keeps a missing error eligible when the handoff is configured', () => {
    expect(isDiagnosticReportEligible(undefined)).toBe(true)
  })

  it('marks upstream server errors ineligible', () => {
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'Service Unavailable' }))).toBe(false)
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'fetch failed' }))).toBe(false)
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'unauthorized' }))).toBe(false)
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'insufficient_balance' }))).toBe(false)
  })

  it('keeps message-only service-unavailable errors eligible', () => {
    expect(isDiagnosticReportEligible(makeError({ message: 'Service temporarily unavailable' }))).toBe(true)
    expect(isDiagnosticReportEligible(makeError({ message: 'Service Unavailable' }))).toBe(true)
  })

  it('keeps a proxy failure that mentions service unavailable eligible', () => {
    expect(
      isDiagnosticReportEligible(makeError({ message: 'net::ERR_PROXY_CONNECTION_FAILED: service unavailable' }))
    ).toBe(true)
    expect(
      isDiagnosticReportEligible(makeError({ message: 'net::ERR_CERT_AUTHORITY_INVALID: service unavailable' }))
    ).toBe(true)
  })

  it.each([
    ['quota', { statusCode: 402, message: 'insufficient_balance' }],
    ['auth', { statusCode: 401, message: 'unauthorized' }],
    ['rate_limit', { statusCode: 429, message: 'too many requests' }],
    ['network', { message: 'net::ERR_CONNECTION_REFUSED' }],
    ['model', { statusCode: 404, message: 'model_not_found' }],
    ['stream', { message: 'stream interrupted' }],
    ['parse', { message: 'JSON parse error' }],
    ['unknown', { message: 'something unexplained happened' }]
  ] as const)('keeps %s errors eligible', (_category, overrides) => {
    expect(isDiagnosticReportEligible(makeError(overrides))).toBe(true)
  })

  it('keeps MCP and OCR service-unavailable errors eligible', () => {
    expect(isDiagnosticReportEligible(makeError({ message: 'MCP error: service unavailable' }))).toBe(true)
    expect(isDiagnosticReportEligible(makeError({ message: 'OCR service unavailable' }))).toBe(true)
  })

  it.each(['unauthorized', 'insufficient_balance', 'too many requests', 'model_not_found', 'fetch failed'])(
    'hides the direct report when a retry wrapper copied "%s" over a terminal HTTP 503',
    (phrase) => {
      const error = makeCopiedRetry(phrase, [
        makeApiCallAttempt({ statusCode: 401, providerErrorCategory: 'auth', message: 'unauthorized' }),
        makeApiCallAttempt({ statusCode: 503, providerErrorCategory: 'server', message: phrase })
      ])

      expect(isDiagnosticReportEligible(error)).toBe(false)
    }
  )

  it('keeps the direct report when an earlier HTTP 503 is not the terminal attempt', () => {
    const error = makeCopiedRetry('rate limit exceeded', [
      makeApiCallAttempt({ statusCode: 503, providerErrorCategory: 'server', message: 'Service Unavailable' }),
      makeApiCallAttempt({ statusCode: 401, providerErrorCategory: 'auth', message: 'unauthorized' })
    ])

    expect(isDiagnosticReportEligible(error)).toBe(true)
  })

  it('keeps message-only MCP, OCR, and transport retries eligible without a terminal HTTP 5xx', () => {
    expect(
      isDiagnosticReportEligible(
        makeCopiedRetry('MCP error: service unavailable', [
          makeApiCallAttempt({ message: 'MCP error: service unavailable' })
        ])
      )
    ).toBe(true)
    expect(
      isDiagnosticReportEligible(
        makeCopiedRetry('OCR service unavailable', [makeApiCallAttempt({ message: 'OCR service unavailable' })])
      )
    ).toBe(true)
    expect(
      isDiagnosticReportEligible(makeCopiedRetry('fetch failed', [makeApiCallAttempt({ message: 'fetch failed' })]))
    ).toBe(true)
  })

  it('keeps the direct report when the wrapper has its own status, category, or content finish reason', () => {
    const terminalServer = [
      makeApiCallAttempt({ statusCode: 503, providerErrorCategory: 'server', message: 'unauthorized' })
    ]

    expect(isDiagnosticReportEligible(makeCopiedRetry('too many requests', terminalServer, { statusCode: 401 }))).toBe(
      true
    )
    expect(
      isDiagnosticReportEligible(makeCopiedRetry('unauthorized', terminalServer, { providerErrorCategory: 'quota' }))
    ).toBe(true)
    expect(
      isDiagnosticReportEligible(makeCopiedRetry('blocked by safety', terminalServer, { finishReason: 'SAFETY' }))
    ).toBe(true)
  })

  it('hides the direct report when the wrapper itself is HTTP 503', () => {
    const error = makeCopiedRetry('unauthorized', [makeApiCallAttempt({ statusCode: 401, message: 'unauthorized' })], {
      statusCode: 503
    })

    expect(isDiagnosticReportEligible(error)).toBe(false)
  })
})
