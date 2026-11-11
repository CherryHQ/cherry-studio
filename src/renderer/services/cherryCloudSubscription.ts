import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { SubscriptionEntrySource, SubscriptionEntryVia } from '@shared/ipc/schemas/cherryCloud'

import { recordSubscribeClick } from './cherryCloudSubscriptionAnalytics'

/** Main coalesces subscription clicks across windows and signs in when required. */
export async function startCherryCloudSubscription(
  source: SubscriptionEntrySource,
  details: { modelId?: string; via?: SubscriptionEntryVia } = {}
): Promise<void> {
  const flowId = recordSubscribeClick()
  cacheService.setPersist('ui.cherry_cloud.subscribe_prompt_seen', true)
  try {
    await ipcApi.request('cherry_cloud.subscription.start', { source, flowId, ...details })
  } catch (error) {
    toast.error({
      key: 'cherry-cloud-subscription',
      title:
        error instanceof IpcError && error.code === cherryCloudErrorCodes.PORTAL_OPEN_FAILED
          ? i18n.t('settings.subscription.open_portal_failed')
          : getCherryCloudSignInErrorMessage(error, i18n.t)
    })
  }
}
