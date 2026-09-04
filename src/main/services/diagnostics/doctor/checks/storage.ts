import { application } from '@application'
import { getNormalizedExecutablePath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { app } from 'electron'

import { defineDoctorCheck } from '../types'

/**
 * Preboot silently falls back to the default directory when the configured custom one is
 * unusable (see `resolveUserDataLocation`), so the app boots but the user's data looks lost.
 */
export const userDataLocation = defineDoctorCheck({
  id: 'storage-userdata-location',
  async run() {
    const actual = application.getPath('app.userdata')
    const configured = app.isPackaged
      ? bootConfigService.get('app.user_data_path')?.[getNormalizedExecutablePath()]
      : undefined
    if (!configured || configured === actual) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'fallback_to_default' },
      actions: [
        { kind: 'open_path', path: actual },
        { kind: 'navigate', target: '/settings/data' }
      ],
      devMessage: 'Configured user data directory was unusable at boot; running on the default directory',
      evidence: [
        { key: 'configured', value: configured, dataClass: 'local_only' },
        { key: 'actual', value: actual, dataClass: 'local_only' },
        { key: 'configuredUsableNow', value: isUsableDataDir(configured), dataClass: 'public' }
      ]
    }
  },
  fixes: {}
})
