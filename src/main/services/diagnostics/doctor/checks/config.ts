import { bootConfigService } from '@main/data/bootConfig'

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
