import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'

import { openCherryCloudAccountPortal } from './cherryCloudAccountPortal'

/**
 * The single action behind every Subscribe touchpoint: dismiss the account-avatar dot and open the
 * edition's account portal, signing in with a Cherry Account first when needed.
 */
export async function startCherryCloudSubscription(): Promise<void> {
  cacheService.setPersist('ui.cherry_cloud.subscribe_prompt_seen', true)
  let status
  try {
    status = await ipcApi.request('cherry_cloud.status.get')
  } catch (error) {
    toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
    return
  }
  if (status.phase === 'signed-in') return openPortal()

  // Sign-in completes in the browser; the touchpoint may unmount before the session arrives.
  const unsubscribe = ipcApi.on('cherry_cloud.status_changed', (next) => {
    if (next.phase === 'authorizing') return
    unsubscribe()
    if (next.phase === 'signed-in') void openPortal()
  })
  try {
    const started = await ipcApi.request('cherry_cloud.login.start')
    if (started.phase === 'signed-in') {
      unsubscribe()
      await openPortal()
    }
  } catch (error) {
    unsubscribe()
    toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
  }
}

async function openPortal(): Promise<void> {
  try {
    await openCherryCloudAccountPortal()
  } catch {
    toast.error(i18n.t('settings.subscription.open_portal_failed'))
  }
}
