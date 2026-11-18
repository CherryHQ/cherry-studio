import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

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
