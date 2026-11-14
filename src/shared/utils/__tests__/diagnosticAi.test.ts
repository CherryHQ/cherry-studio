import { describe, expect, it } from 'vitest'

import { diagnosticsRequestSchemas } from '@shared/ipc/schemas/diagnostics'
import { DIAGNOSTIC_AI_ID_MAX, DIAGNOSTIC_AI_TEXT_MAX, diagnosticAiDiagnosisSchema } from '@shared/types/diagnosticAi'

import { projectDiagnosticAiDiagnosis, selectDiagnosticAiAttachment } from '../diagnosticAi'
import { REDACTED } from '../redaction'

const bundleInput = {
  includeChatRecords: false,
  includeLogs: false,
  includeTraces: false,
  range: '24h' as const
}

describe('diagnosticAiDiagnosisSchema', () => {
  it('accepts a diagnosis without model or run metadata and rejects extra payloads', () => {
    expect(
      diagnosticAiDiagnosisSchema.safeParse({
        source: 'doctor-agent',
        status: 'completed',
        text: 'The request was refused.'
      }).success
    ).toBe(true)
    expect(
      diagnosticAiDiagnosisSchema.safeParse({
        source: 'doctor-agent',
        status: 'completed',
        text: 'done',
        toolCalls: ['write_file'],
        proposals: [{ kind: 'preference_set' }]
      }).success
    ).toBe(false)
    expect(
      diagnosticAiDiagnosisSchema.safeParse({
        source: 'doctor-agent',
        status: 'completed',
        text: 'x'.repeat(DIAGNOSTIC_AI_TEXT_MAX + 1)
      }).success
    ).toBe(false)
    expect(
      diagnosticAiDiagnosisSchema.safeParse({
        source: 'doctor-agent',
        status: 'completed',
        text: 'done',
        runId: 'r'.repeat(DIAGNOSTIC_AI_ID_MAX + 1)
      }).success
    ).toBe(false)
  })

  it('is optional on diagnostic bundle export and upload', () => {
    const diagnosis = { source: 'doctor-agent', status: 'failed', text: 'summary only' }
    expect(diagnosticsRequestSchemas['diagnostics.bundle.export'].input.safeParse(bundleInput).success).toBe(true)
    expect(
      diagnosticsRequestSchemas['diagnostics.bundle.export'].input.safeParse({ ...bundleInput, aiDiagnosis: diagnosis })
        .success
    ).toBe(true)
    expect(
      diagnosticsRequestSchemas['diagnostics.bundle.upload'].input.safeParse({
        ...bundleInput,
        description: 'The app froze.',
        aiDiagnosis: diagnosis
      }).success
    ).toBe(true)
  })
})

describe('projectDiagnosticAiDiagnosis', () => {
  it('redacts secrets, caps long text, and does not invent metadata', () => {
    const secret = 'plain-secret-value-123456'
    const token = `sk-proj-${'a'.repeat(24)}`
    const projected = projectDiagnosticAiDiagnosis({
      source: 'doctor-agent',
      status: 'completed',
      text: `api_key=${secret}\n${token}\n${'finding '.repeat(9_000)}`,
      scope: 'chat:openai/gpt-4o',
      runId: 'run-1'
    })

    expect(projected?.truncated).toBe(true)
    expect(projected?.text).toHaveLength(DIAGNOSTIC_AI_TEXT_MAX)
    expect(projected?.text).not.toContain(secret)
    expect(projected?.text).not.toContain(token)
    expect(projected?.text).toContain(REDACTED)
    expect(projected).toMatchObject({
      source: 'doctor-agent',
      status: 'completed',
      scope: 'chat:openai/gpt-4o',
      runId: 'run-1'
    })
    expect(projected).not.toHaveProperty('modelId')
    expect(projected).not.toHaveProperty('reportRunId')
    expect(projected).not.toHaveProperty('toolCalls')
  })

  it('keeps a short diagnosis as supplied, including failed and canceled status', () => {
    expect(
      projectDiagnosticAiDiagnosis({ source: 'doctor-agent', status: 'failed', text: '  Quota exceeded.  ' })
    ).toEqual({ source: 'doctor-agent', status: 'failed', text: 'Quota exceeded.' })
    expect(
      projectDiagnosticAiDiagnosis({
        source: 'doctor-agent',
        status: 'canceled',
        text: 'Stopped after the first check.'
      })
    ).toEqual({ source: 'doctor-agent', status: 'canceled', text: 'Stopped after the first check.' })
  })

  it('replaces local home directories the same way as the error context', () => {
    const projected = projectDiagnosticAiDiagnosis({
      source: 'doctor-agent',
      status: 'completed',
      text: 'Config at /Users/alice/.cherry/config.json and C:\\Users\\bob\\AppData is unreadable.'
    })

    expect(projected?.text).toBe('Config at ~/.cherry/config.json and ~\\AppData is unreadable.')
  })

  it('drops a diagnosis whose text is empty after redaction', () => {
    expect(projectDiagnosticAiDiagnosis({ source: 'doctor-agent', status: 'completed', text: '   ' })).toBeUndefined()
  })

  it('keeps a final conclusion that is longer than 8000 characters and shorter than the archive cap', () => {
    const ending = 'FINAL CONCLUSION'
    const text = `${'finding '.repeat(1_200)}${ending}`
    expect(text.length).toBeGreaterThan(8_000)
    expect(text.length).toBeLessThan(DIAGNOSTIC_AI_TEXT_MAX)

    const projected = projectDiagnosticAiDiagnosis({ source: 'doctor-agent', status: 'completed', text })

    expect(projected?.text.endsWith(ending)).toBe(true)
    expect(projected?.text.length).toBeGreaterThan(8_000)
    expect(projected?.truncated).toBeUndefined()
  })

  it('caps text over the archive budget, marks it truncated, and passes the IPC schema', () => {
    const ending = 'TAIL_MARKER'
    const text = `${'x'.repeat(DIAGNOSTIC_AI_TEXT_MAX)}${ending}`
    const projected = projectDiagnosticAiDiagnosis({ source: 'doctor-agent', status: 'failed', text })

    expect(projected?.truncated).toBe(true)
    expect(projected?.text).toHaveLength(DIAGNOSTIC_AI_TEXT_MAX)
    expect(projected?.text).not.toContain(ending)
    expect(diagnosticAiDiagnosisSchema.safeParse(projected).success).toBe(true)
    expect(
      diagnosticsRequestSchemas['diagnostics.bundle.upload'].input.safeParse({
        ...bundleInput,
        description: 'The app froze.',
        aiDiagnosis: projected
      }).success
    ).toBe(true)

    const again = projected ? projectDiagnosticAiDiagnosis({ ...projected, text: 'short conclusion' }) : undefined
    expect(again).toEqual({
      source: 'doctor-agent',
      status: 'failed',
      text: 'short conclusion',
      truncated: true
    })
  })
})

describe('selectDiagnosticAiAttachment', () => {
  const errorContext = { id: 'err-1', message: 'upstream failed' }

  it('omits a diagnosis for a different fault and an invalid payload', () => {
    expect(
      selectDiagnosticAiAttachment(
        { source: 'doctor-agent', status: 'completed', text: 'This fault.', errorId: 'err-2' },
        errorContext
      )
    ).toBeUndefined()
    expect(
      selectDiagnosticAiAttachment(
        { source: 'doctor-agent', status: 'completed', text: 'This fault.', toolCalls: ['read_logs'] },
        errorContext
      )
    ).toBeUndefined()
  })

  it('keeps a diagnosis whose error id matches, and one that names no fault', () => {
    expect(
      selectDiagnosticAiAttachment(
        { source: 'doctor-agent', status: 'completed', text: 'This fault.', errorId: 'err-1' },
        errorContext
      )
    ).toEqual({ source: 'doctor-agent', status: 'completed', text: 'This fault.', errorId: 'err-1' })
    expect(selectDiagnosticAiAttachment({ source: 'doctor-agent', status: 'completed', text: 'No fault id.' })).toEqual(
      { source: 'doctor-agent', status: 'completed', text: 'No fault id.' }
    )
  })

  it('omits a contextual diagnosis that does not name the fault', () => {
    expect(
      selectDiagnosticAiAttachment({ source: 'doctor-agent', status: 'completed', text: 'No fault id.' }, errorContext)
    ).toBeUndefined()
  })

  it('keeps a global diagnosis when no error context is supplied', () => {
    expect(
      selectDiagnosticAiAttachment({
        source: 'doctor-agent',
        status: 'completed',
        text: 'Global analysis.',
        errorId: 'err-9'
      })
    ).toEqual({ source: 'doctor-agent', status: 'completed', text: 'Global analysis.', errorId: 'err-9' })
  })
})
