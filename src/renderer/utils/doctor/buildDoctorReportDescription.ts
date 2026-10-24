import type { DoctorCheckId, DoctorCheckResult } from '@shared/types/doctor'
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'

export function buildDoctorReportDescription(input: {
  readonly checkId: DoctorCheckId
  readonly result?: DoctorCheckResult
  readonly descriptionDraft: string
  readonly checkDescription: string
  readonly formatRuleIds: (ruleIds: string) => string
}): string | undefined {
  const { checkId, result, descriptionDraft, checkDescription, formatRuleIds } = input
  if (checkId !== 'logs-recent-findings' || result?.id !== checkId || result.status !== 'warn') return undefined

  const ruleIds = new Set<string>()
  for (const item of result.evidence ?? []) {
    if (item.key !== 'ruleIds' || item.dataClass !== 'public' || typeof item.value !== 'string') continue
    for (const value of item.value.split(',')) {
      const id = value.trim()
      if (id) ruleIds.add(id)
    }
  }
  if (ruleIds.size === 0) return undefined

  const automaticBlock = `${checkDescription}\n${formatRuleIds([...ruleIds].join(', '))}`
  const draft = descriptionDraft.trim()
  const normalizedDraft = normalizeDiagnosticDescription(draft)
  const normalizedBlock = normalizeDiagnosticDescription(automaticBlock)
  if (normalizedDraft === normalizedBlock || normalizedDraft.endsWith(`\r\n\r\n${normalizedBlock}`)) return draft
  return draft ? `${draft}\n\n${automaticBlock}` : automaticBlock
}
