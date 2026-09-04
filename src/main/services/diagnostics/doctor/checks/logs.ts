import { application } from '@application'
import { collectErrorLogRecords, diagnose, type DiagnosticDomain } from '@main/services/diagnostics/scan'
import type { DoctorAction, DoctorAttribution, DoctorNavigateTarget } from '@shared/types/doctor'

import { defineDoctorCheck } from '../types'

const RECENT_LOG_RANGE_MS = 24 * 60 * 60 * 1000
const NAV_TARGET_BY_DOMAIN: Partial<Record<DiagnosticDomain, DoctorNavigateTarget>> = {
  provider: '/settings/provider',
  network: '/settings/general',
  mcp: '/settings/mcp',
  chat: '/settings/provider',
  environment: '/settings/data'
}

export const recentLogFindings = defineDoctorCheck({
  id: 'logs-recent-findings',
  async run() {
    const toMs = Date.now()
    const scanned = await collectErrorLogRecords(application.getPath('app.logs'), {
      fromMs: toMs - RECENT_LOG_RANGE_MS,
      toMs
    })
    const findings = diagnose(scanned.records)
    if (findings.length === 0) return { status: 'pass' }

    const actions: DoctorAction<'logs-recent-findings'>[] = []
    if (findings.some((finding) => finding.attribution === 'app-bug')) actions.push({ kind: 'report' })
    const targets = new Set<DoctorNavigateTarget>()
    for (const finding of findings) {
      if (finding.attribution !== 'user-fixable') continue
      const target = NAV_TARGET_BY_DOMAIN[finding.domain]
      if (target) targets.add(target)
    }
    for (const target of targets) actions.push({ kind: 'navigate', target })

    const attribution: DoctorAttribution = findings.some((finding) => finding.attribution === 'app-bug')
      ? 'app-bug'
      : findings.some((finding) => finding.attribution === 'user-fixable')
        ? 'user-fixable'
        : 'transient'
    const occurrences = findings.reduce((total, finding) => total + finding.count, 0)

    return {
      status: 'warn',
      attribution,
      detail: { variant: 'findings', params: { count: findings.length, occurrences } },
      actions,
      devMessage: findings.map((finding) => `${finding.ruleId}: ${finding.devMessage}`).join('; '),
      evidence: [
        { key: 'ruleIds', value: findings.map((finding) => finding.ruleId).join(', '), dataClass: 'public' },
        { key: 'occurrences', value: occurrences, dataClass: 'public' },
        { key: 'unparsedLineCount', value: scanned.unparsedLineCount, dataClass: 'public' },
        { key: 'skippedFileCount', value: scanned.skippedFileCount, dataClass: 'public' },
        { key: 'truncated', value: scanned.truncated, dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})
