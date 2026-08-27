import type { SerializedError } from '@renderer/types/error'
import { diagnosticDescriptionByteLength } from '@shared/utils/diagnostics'
import { describe, expect, it } from 'vitest'

import {
  buildDiagnosticReportDescription,
  DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES,
  type DiagnosticReportDescriptionLabels
} from '../diagnosticReportDescription'

const labels: DiagnosticReportDescriptionLabels = {
  aiDiagnosis: 'AI diagnosis',
  errorMessage: 'Error message',
  errorName: 'Error name',
  location: 'Location',
  model: 'Model',
  provider: 'Provider',
  statusCode: 'Status code'
}

describe('buildDiagnosticReportDescription', () => {
  it('includes approved error context and excludes sensitive payload fields', () => {
    const error = {
      name: 'AI_APICallError',
      message: 'Rate limit exceeded',
      stack: 'secret stack',
      cause: 'secret cause',
      statusCode: 429,
      url: 'https://provider.example/private',
      requestBodyValues: { prompt: 'secret prompt' },
      responseBody: 'secret response',
      toolInput: 'secret tool input'
    } as SerializedError

    const description = buildDiagnosticReportDescription({
      diagnosis: {
        category: 'provider-quota-category',
        explanation: 'The provider rate-limited this request.',
        steps: [{ text: 'Wait and retry.' }],
        summary: 'Rate limited'
      },
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
        'Error message: Rate limit exceeded',
        '',
        'AI diagnosis:',
        'The provider rate-limited this request.'
      ].join('\r\n')
    )
    expect(description).not.toContain('secret')
    expect(description).not.toContain('Wait and retry')
    expect(description).not.toContain('provider-quota-category')
  })

  it('falls back to the diagnosis summary and omits unavailable context', () => {
    expect(
      buildDiagnosticReportDescription({
        diagnosis: { category: 'runtime', explanation: '', steps: [], summary: 'Runtime failed' },
        error: { name: null, message: 'failed', stack: null },
        labels,
        location: 'Agent conversation'
      })
    ).toBe(
      ['Location: Agent conversation', 'Error message: failed', '', 'AI diagnosis:', 'Runtime failed'].join('\r\n')
    )
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
