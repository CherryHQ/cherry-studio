import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { CherryCloudAmdStatus } from '@shared/ipc/schemas/cherryCloud'

/** Names the AMD step the account needs next from the server's `action`; generic until the status is known. */
export function getAmdActionLabelKey(status: CherryCloudAmdStatus | undefined) {
  switch (status?.action) {
    case 'register':
      return 'models.amd_free.action.register'
    case 'login':
      return status.status === 'credential_invalid' ? 'models.amd_free.action.reverify' : 'models.amd_free.action.link'
    case 'continue':
      return 'models.amd_free.action.continue'
    case 'wait':
      return 'models.amd_free.action.wait'
    case 'contact_support':
      return 'models.amd_free.action.contact_support'
    default:
      return 'models.amd_free.tag'
  }
}

/** Main signs in when required, then opens the single-use AMD entry that proves the visit came from this client. */
export async function openAmdRegistration(modelId: string): Promise<void> {
  trackSubscriptionEvent({ event: 'amd_entry_clicked', flowId: crypto.randomUUID(), modelId })
  try {
    await ipcApi.request('cherry_cloud.amd_entry.open', { modelId })
  } catch (error) {
    toast.error({
      key: 'cherry-cloud-amd-entry',
      title:
        error instanceof IpcError && error.code === cherryCloudErrorCodes.AMD_ENTRY_FAILED
          ? i18n.t('models.amd_free.open_failed')
          : getCherryCloudSignInErrorMessage(error, i18n.t)
    })
  }
}
