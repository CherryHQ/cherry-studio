import type { TFunction } from 'i18next'

import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

/** The user-facing reason a `cherry_cloud.login.start` request failed. */
export function getCherryCloudSignInErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof IpcError) {
    if (error.code === cherryCloudErrorCodes.UPGRADE_REQUIRED)
      return t('settings.provider.cherry_cloud.upgrade_required')
    if (error.code === cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE) return t('error.http.503')
  }
  return t('settings.provider.cherry_cloud.sign_in_failed')
}
