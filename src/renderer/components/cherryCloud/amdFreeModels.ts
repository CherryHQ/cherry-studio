import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

// Placeholder until Cherry Cloud's catalog lists AMD's free models; ids follow AMD's model docs.
export const AMD_FREE_MODELS = [
  { id: 'qwen3-8-27b', name: 'Qwen3.8 27B' },
  { id: 'mimo-v2-6-flash', name: 'MiMo V2.6 Flash' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
] as const

/** AMD's partner registration only accepts mainland China phone numbers, so the offer is China-only. */
export function isAmdFreeModelsOfferAvailable(): boolean {
  return getAppEdition() === 'cn'
}

/** Main signs in when required, then opens the single-use AMD entry that proves the visit came from this client. */
export async function openAmdRegistration(modelId: string): Promise<void> {
  trackSubscriptionEvent({ event: 'amd_entry_clicked', flowId: crypto.randomUUID(), modelId })
  try {
    await ipcApi.request('cherry_cloud.amd_entry.open')
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
