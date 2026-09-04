import { application } from '@application'
import { isUsableDataDir } from '@main/core/preboot/userDataLocation'

import { defineDoctorCheck } from '../types'

export const userDataWritable = defineDoctorCheck({
  id: 'storage-userdata-writable',
  async run() {
    const path = application.getPath('app.userdata')
    if (isUsableDataDir(path)) return { status: 'pass' }
    return {
      status: 'fail',
      attribution: 'user-fixable',
      detail: { variant: 'not_writable', params: { path } },
      actions: [
        { kind: 'open_path', path },
        { kind: 'navigate', target: '/settings/data' }
      ],
      devMessage: 'User data directory is missing or not readable/writable/traversable',
      evidence: [{ key: 'path', value: path, dataClass: 'local_only' }]
    }
  },
  fixes: {}
})
