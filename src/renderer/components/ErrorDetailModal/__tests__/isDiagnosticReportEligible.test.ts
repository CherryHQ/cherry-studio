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

describe('isDiagnosticReportEligible', () => {
  it('keeps a missing error eligible when the handoff is configured', () => {
    expect(isDiagnosticReportEligible(undefined)).toBe(true)
  })

  it('marks upstream server errors ineligible', () => {
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'Service Unavailable' }))).toBe(false)
    expect(isDiagnosticReportEligible(makeError({ message: 'Service temporarily unavailable' }))).toBe(false)
    expect(isDiagnosticReportEligible(makeError({ statusCode: 503, message: 'fetch failed' }))).toBe(false)
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
})
