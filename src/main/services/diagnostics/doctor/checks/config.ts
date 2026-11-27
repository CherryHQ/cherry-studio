import { bootConfigService } from '@main/data/bootConfig'
import { diagnose } from '@main/services/diagnostics/scan'

import { recentLogScan } from '../logScan'
import { defineDoctorCheck } from '../types'

const DETAIL_BY_ERROR = {
  validation_error: 'invalid_keys',
  parse_error: 'parse_error',
  read_error: 'read_error'
} as const

export const bootConfigValid = defineDoctorCheck({
  id: 'config-boot-config-valid',
  async run() {
    const error = bootConfigService.getLoadError()
    if (!error) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: DETAIL_BY_ERROR[error.type], params: { count: error.invalidKeys?.length ?? 0 } },
      actions: [{ kind: 'fix', fixId: 'repair' }],
      devMessage: `Boot config ${error.type}: ${error.message}`,
      evidence: [
        { key: 'invalidKeys', value: error.invalidKeys?.join(', ') ?? '', dataClass: 'public' },
        { key: 'filePath', value: error.filePath, dataClass: 'local_only' }
      ]
    }
  },
  fixes: {
    async repair() {
      bootConfigService.repair()
      return { status: 'requires_relaunch' }
    }
  }
})

export const hardwareAcceleration = defineDoctorCheck({
  id: 'config-hardware-acceleration',
  timeoutMs: 20_000,
  async run(ctx) {
    if (!bootConfigService.get('app.disable_hardware_acceleration')) return { status: 'pass' }

    const scanned = await recentLogScan(ctx)
    if (!scanned.complete) throw new Error('Cannot assess hardware acceleration: the seven-day log scan is incomplete')
    const hasRecentRendererCrash = diagnose(scanned.records).some(
      (finding) => finding.ruleId === 'environment-renderer-crashed'
    )
    if (hasRecentRendererCrash) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'disabled_without_recent_crash' },
      actions: [{ kind: 'navigate', target: '/settings/general' }]
    }
  },
  fixes: {}
})
