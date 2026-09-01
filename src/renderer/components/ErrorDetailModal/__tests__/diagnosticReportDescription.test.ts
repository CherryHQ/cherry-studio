import type { SerializedError } from '@renderer/types/error'
import { diagnosticDescriptionByteLength } from '@shared/utils/diagnostics'
import { describe, expect, it } from 'vitest'

import {
  buildDiagnosticReportDescription,
  DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES,
  type DiagnosticReportDescriptionLabels
} from '../diagnosticReportDescription'

const labels: DiagnosticReportDescriptionLabels = {
  errorMessage: 'Error message',
  errorName: 'Error name',
  location: 'Location',
  model: 'Model',
  provider: 'Provider',
  statusCode: 'Status code'
}

describe('buildDiagnosticReportDescription', () => {
  it('keeps provider-returned text already present in the message without copying payload fields', () => {
    const error = {
      name: 'AI_APICallError',
      message: 'Rate limit exceeded for private-account@example.com',
      stack: 'secret stack',
      cause: 'secret cause',
      statusCode: 429,
      url: 'https://provider.example/private',
      requestBodyValues: { prompt: 'secret prompt' },
      responseBody: 'secret response payload',
      toolInput: 'secret tool input'
    } as SerializedError

    const description = buildDiagnosticReportDescription({
      diagnosisContext: { modelId: 'gpt-5', providerName: 'OpenAI' },
      error,
      labels,
      location: 'Home conversation'
    })

    expect(description).toBe(
      [
        'Location: Home conversation',
        'Provider: OpenAI',
        'Model: gpt-5',
        'Error name: AI_APICallError',
        'Status code: 429',
        'Error message: Rate limit exceeded for private-account@example.com'
      ].join('\r\n')
    )
    expect(description).not.toContain('secret response payload')
  })

  it('omits unavailable context', () => {
    expect(
      buildDiagnosticReportDescription({
        error: { name: null, message: 'failed', stack: null },
        labels,
        location: 'Agent conversation'
      })
    ).toBe(['Location: Agent conversation', 'Error message: failed'].join('\r\n'))
  })

  it('truncates multibyte descriptions within the normalized UTF-8 byte budget', () => {
    const description = buildDiagnosticReportDescription({
      error: { name: 'ProviderError', message: '故障\n'.repeat(2_000), stack: null },
      labels,
      location: 'Home conversation'
    })

    expect(diagnosticDescriptionByteLength(description)).toBeLessThanOrEqual(DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES)
    expect(description).not.toContain('\uFFFD')
    expect(description).not.toMatch(/\r$/)
  })
})
