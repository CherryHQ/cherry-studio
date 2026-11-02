import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage, getCherryCloudSignInFailureReason } from '@renderer/utils/cherryCloudSignIn'
import type { SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

import { openCherryCloudAccountPortal } from './cherryCloudAccountPortal'
import { recordSubscribeClick, trackSubscriptionEvent } from './cherryCloudSubscriptionAnalytics'

let cancelPendingSignIn: (() => void) | undefined

/**
 * The single action behind every Subscribe touchpoint: dismiss the account-avatar dot and open the
 * edition's account portal, signing in with a Cherry Account first when needed. `source` names the
 * touchpoint for subscription analytics.
 */
export async function startCherryCloudSubscription(
  source: SubscriptionEntrySource,
  details: { modelId?: string } = {}
): Promise<void> {
  cacheService.setPersist('ui.cherry_cloud.subscribe_prompt_seen', true)
  const flowId = recordSubscribeClick()
  let status
  try {
    status = await ipcApi.request('cherry_cloud.status.get')
  } catch (error) {
    toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
    return
  }
  const signedIn = status.phase === 'signed-in'
  trackSubscriptionEvent({ event: 'subscription_entry_click', source, flowId, signedIn, ...details })
  if (signedIn) return openPortal(source, flowId)

  // Sign-in completes in the browser; the touchpoint may unmount before the session arrives. A later
  // click replaces this wait, so the portal opens once however often Subscribe was pressed.
  cancelPendingSignIn?.()
  const unsubscribe = ipcApi.on('cherry_cloud.status_changed', (next) => {
    if (next.phase === 'authorizing') return
    unsubscribe()
    const result = next.phase === 'signed-in' ? 'success' : 'cancelled'
    trackSubscriptionEvent({ event: 'subscription_sign_in_result', flowId, result })
    if (result === 'success') void openPortal(source, flowId)
  })
  cancelPendingSignIn = unsubscribe
  try {
    const started = await ipcApi.request('cherry_cloud.login.start')
    if (started.phase === 'signed-in') {
      unsubscribe()
      trackSubscriptionEvent({ event: 'subscription_sign_in_result', flowId, result: 'success' })
      await openPortal(source, flowId)
    }
  } catch (error) {
    unsubscribe()
    trackSubscriptionEvent({
      event: 'subscription_sign_in_result',
      flowId,
      result: 'failed',
      reason: getCherryCloudSignInFailureReason(error)
    })
    toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
  }
}

async function openPortal(source: SubscriptionEntrySource, flowId: string): Promise<void> {
  try {
    await openCherryCloudAccountPortal({ entrySource: source, flowId })
    trackSubscriptionEvent({ event: 'subscription_portal_open', source, flowId, result: 'success' })
  } catch {
    trackSubscriptionEvent({ event: 'subscription_portal_open', source, flowId, result: 'failed' })
    toast.error(i18n.t('settings.subscription.open_portal_failed'))
  }
}
