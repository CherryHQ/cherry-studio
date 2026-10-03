import { describe, expect, it } from 'vitest'

import type { SerializedError } from '@renderer/types/error'
import { diagnosticDescriptionByteLength } from '@shared/utils/diagnostics'

import {
  buildDiagnosticReportDescription,
  DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES,
  type DiagnosticReportDescriptionLabels,
  diagnosticReportFields,
  resolveDiagnosticReportLocation
} from '../diagnosticReportDescription'

const labels: DiagnosticReportDescriptionLabels = {
  errorMessage: 'Error message',
  location: 'Location',
  model: 'Model'
}

describe('buildDiagnosticReportDescription', () => {
  it('projects normalized location, combined model, and combined error fields in display order', () => {
    const error = {
      name: ' ProviderError ',
      message: ' failed ',
      stack: null,
      status: 503,
      statusCode: 429
    } as SerializedError

    expect(
      diagnosticReportFields({
        diagnosisContext: { modelId: ' gpt-5 ', providerId: ' OpenAI ' },
        error,
        location: ' Home conversation '
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'OpenAI:gpt-5' },
      { id: 'errorMessage', value: 'ProviderError: failed' }
    ])
  })

  it('keeps whichever model and error parts are available', () => {
    expect(
      diagnosticReportFields({
        diagnosisContext: { modelId: 'gpt-5' },
        error: { name: null, message: 'failed', stack: null },
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'gpt-5' },
      { id: 'errorMessage', value: 'failed' }
    ])

    expect(
      diagnosticReportFields({
        error: { name: 'AuthError', message: 'Unauthorized', stack: null },
        localizedErrorMessage: 'API Key 无效，请检查并重新配置',
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'errorMessage', value: 'API Key 无效，请检查并重新配置 (Unauthorized)' }
    ])

    expect(
      diagnosticReportFields({
        diagnosisContext: { providerId: 'OpenAI' },
        error: { name: 'ProviderError', message: null, stack: null },
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'OpenAI' },
      { id: 'errorMessage', value: 'ProviderError' }
    ])

    expect(
      diagnosticReportFields({
        error: { name: null, message: null, stack: null },
        location: 'Home conversation'
      })
    ).toEqual([{ id: 'location', value: 'Home conversation' }])
  })

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
      diagnosisContext: { modelId: 'gpt-5', providerId: 'OpenAI' },
      error,
      labels,
      location: 'Home conversation'
    })

    expect(description).toBe(
      [
        'Location: Home conversation',
        'Model: OpenAI:gpt-5',
        'Error message: AI_APICallError: Rate limit exceeded for private-account@example.com'
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

describe('resolveDiagnosticReportLocation', () => {
  const t = (key: string, options?: { defaultValue?: string }) =>
    key === 'error.diagnostic_report.locations.work'
      ? '工作对话'
      : key === 'error.diagnostic_report.locations.home'
        ? '普通对话'
        : (options?.defaultValue ?? key)

  it('maps Agent location ids and leftover Chinese copy to the work-conversation label', () => {
    expect(resolveDiagnosticReportLocation(t, 'agent', 'zh-CN')).toBe('工作对话')
    expect(resolveDiagnosticReportLocation(t, 'Agent 对话', 'zh-CN')).toBe('工作对话')
  })

  it('maps the home location id', () => {
    expect(resolveDiagnosticReportLocation(t, 'home')).toBe('普通对话')
  })

  it('leaves already-translated locations unchanged', () => {
    expect(resolveDiagnosticReportLocation(t, 'Agent conversation')).toBe('Agent conversation')
  })
})
