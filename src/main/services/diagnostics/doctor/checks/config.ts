import { application } from '@application'
import { bootConfigService } from '@main/data/bootConfig'
import { collectErrorLogRecords } from '@main/services/diagnostics/scan'

import { defineDoctorCheck } from '../types'

const DETAIL_BY_ERROR = {
  validation_error: 'invalid_keys',
  parse_error: 'parse_error',
  read_error: 'read_error'
} as const

const RECENT_RENDERER_CRASH_RANGE_MS = 7 * 24 * 60 * 60 * 1000

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
  async run() {
    if (!bootConfigService.get('app.disable_hardware_acceleration')) return { status: 'pass' }

    const toMs = Date.now()
    const scanned = await collectErrorLogRecords(application.getPath('app.logs'), {
      fromMs: toMs - RECENT_RENDERER_CRASH_RANGE_MS,
      toMs
    })
    const hasRecentRendererCrash = scanned.records.some(({ message }) =>
      message.includes('Renderer process crashed with:')
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
