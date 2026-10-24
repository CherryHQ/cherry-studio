import { describe, expect, it } from 'vitest'

import type { DoctorCheckResult, DoctorEvidenceItem } from '@shared/types/doctor'
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'

import { buildDoctorReportDescription } from '../buildDoctorReportDescription'

const identity = 'Recent app issues [logs-recent-findings]'
const automaticBlock =
  'Recent app issues [logs-recent-findings]\nMatched rule IDs: chat-stream-error, mcp-connection-closed'
const evidence: readonly DoctorEvidenceItem[] = [
  { key: 'ruleIds', value: 'chat-stream-error, mcp-connection-closed', dataClass: 'public' }
]
const warning: DoctorCheckResult = {
  id: 'logs-recent-findings',
  status: 'warn',
  durationMs: 1,
  attribution: 'app-bug',
  detail: { variant: 'findings' },
  actions: [],
  evidence
}
const input = {
  checkId: 'logs-recent-findings' as const,
  result: warning,
  descriptionDraft: '',
  checkDescription: identity,
  formatRuleIds: (ruleIds: string) => `Matched rule IDs: ${ruleIds}`
}

describe('buildDoctorReportDescription', () => {
  it('includes every public ID and the check identity for an empty draft', () => {
    expect(buildDoctorReportDescription(input)).toBe(automaticBlock)
    expect(buildDoctorReportDescription({ ...input, descriptionDraft: ' \n ' })).toBe(automaticBlock)
  })

  it('preserves the written draft and appends the complete automatic block', () => {
    expect(buildDoctorReportDescription({ ...input, descriptionDraft: '  App freezes.  ' })).toBe(
      'App freezes.\n\nRecent app issues [logs-recent-findings]\nMatched rule IDs: chat-stream-error, mcp-connection-closed'
    )
    expect(buildDoctorReportDescription({ ...input, descriptionDraft: '  chat-stream-error\r\nMore details  ' })).toBe(
      `chat-stream-error\r\nMore details\n\n${automaticBlock}`
    )
  })

  it('deduplicates nonempty IDs in first appearance order across evidence entries', () => {
    expect(
      buildDoctorReportDescription({
        ...input,
        result: {
          ...warning,
          evidence: [
            { key: 'ruleIds', value: 'chat-stream-error, , chat-stream-error', dataClass: 'public' },
            { key: 'ruleIds', value: 'mcp-connection-closed, ', dataClass: 'public' }
          ]
        }
      })
    ).toBe(automaticBlock)
  })

  it('excludes nonpublic evidence, nonstring values, other keys and developer messages', () => {
    const privateEvidence: readonly DoctorEvidenceItem[] = [
      { key: 'ruleIds', value: 'LOCAL_SECRET', dataClass: 'local_only' },
      { key: 'ruleIds', value: 'CONSENT_SECRET', dataClass: 'consent_required' },
      { key: 'ruleIds', value: 12345, dataClass: 'public' },
      { key: 'ruleIds', value: true, dataClass: 'public' },
      { key: 'other', value: 'OTHER_SECRET', dataClass: 'public' }
    ]
    const result = { ...warning, devMessage: 'DEV_SECRET', evidence: [...evidence, ...privateEvidence] }
    const description = buildDoctorReportDescription({ ...input, result })
    expect(description).toBe(automaticBlock)
    for (const secret of ['LOCAL_SECRET', 'CONSENT_SECRET', '12345', 'true', 'OTHER_SECRET', 'DEV_SECRET']) {
      expect(description).not.toContain(secret)
    }
    expect(buildDoctorReportDescription({ ...input, result: { ...result, evidence: privateEvidence } })).toBeUndefined()
  })

  it('leaves absent, mismatched and other check results on the legacy path', () => {
    expect(buildDoctorReportDescription({ ...input, result: undefined })).toBeUndefined()
    const other: DoctorCheckResult = {
      id: 'install-native-modules',
      status: 'warn',
      durationMs: 1,
      attribution: 'app-bug',
      detail: { variant: 'unavailable' },
      actions: [],
      evidence
    }
    expect(buildDoctorReportDescription({ ...input, result: other })).toBeUndefined()
    expect(buildDoctorReportDescription({ ...input, checkId: 'install-native-modules' })).toBeUndefined()
    expect(buildDoctorReportDescription({ ...input, checkId: 'install-native-modules', result: other })).toBeUndefined()
  })

  it.each(['pass', 'error', 'fail', 'skip'] as const)('does not enhance a %s result', (status) => {
    const result = { ...warning, status, message: 'failure', skippedBy: 'logs-recent-findings' } as DoctorCheckResult
    expect(buildDoctorReportDescription({ ...input, result })).toBeUndefined()
  })

  it.each([undefined, [], [{ key: 'ruleIds', value: ' , \n, ', dataClass: 'public' as const }]])(
    'leaves results without usable IDs on the legacy path (%j)',
    (items) => {
      expect(buildDoctorReportDescription({ ...input, result: { ...warning, evidence: items } })).toBeUndefined()
    }
  )

  it.each(['\n', '\r\n'])('does not append an identical automatic block twice with %j line endings', (newline) => {
    for (const draft of ['', 'App freezes.']) {
      const first = buildDoctorReportDescription({ ...input, descriptionDraft: draft })!
      const second = buildDoctorReportDescription({ ...input, descriptionDraft: first.replaceAll('\n', newline) })!
      expect(normalizeDiagnosticDescription(second)).toBe(normalizeDiagnosticDescription(first))
    }
  })

  it('retains complete IDs and long drafts without truncation', () => {
    const id = `future-${'x'.repeat(5000)}`
    expect(
      buildDoctorReportDescription({
        ...input,
        descriptionDraft: 'a'.repeat(5000),
        result: {
          ...warning,
          evidence: [{ key: 'ruleIds', value: id, dataClass: 'public' }]
        }
      })
    ).toBe(`${'a'.repeat(5000)}\n\n${identity}\nMatched rule IDs: ${id}`)
  })
})
