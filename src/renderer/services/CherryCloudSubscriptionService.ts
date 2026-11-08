import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage, getCherryCloudSignInFailureReason } from '@renderer/utils/cherryCloudSignIn'
import type { SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

import { openCherryCloudAccountPortal } from './cherryCloudAccountPortal'
import { recordSubscribeClick, trackSubscriptionEvent } from './cherryCloudSubscriptionAnalytics'

export type CherryCloudSubscribeOutcome =
  | { outcome: 'portal_invoked' }
  | { outcome: 'not_completed'; reason: 'superseded' | 'disposed' | 'cancelled' | 'expired' | 'rejected' | 'stopped' }
  | { outcome: 'failed' }

type SubscriptionIntent = {
  flowId: string
  source: SubscriptionEntrySource
  submitted: boolean
  finished: boolean
  completion: ReturnType<typeof Promise.withResolvers<CherryCloudSubscribeOutcome>>
}

/** A window's latest unsubmitted Subscribe action; authentication remains process-owned. */
export class CherryCloudSubscriptionService {
  private intent: SubscriptionIntent | null = null
  private disposed = false

  public start(
    source: SubscriptionEntrySource,
    details: { modelId?: string } = {}
  ): Promise<CherryCloudSubscribeOutcome> {
    if (this.disposed) return Promise.resolve({ outcome: 'not_completed', reason: 'disposed' })
    if (this.intent && !this.intent.submitted)
      this.finishIntent(this.intent, { outcome: 'not_completed', reason: 'superseded' })
    const intent: SubscriptionIntent = {
      flowId: recordSubscribeClick(),
      source,
      submitted: false,
      finished: false,
      completion: Promise.withResolvers<CherryCloudSubscribeOutcome>()
    }
    this.intent = intent
    cacheService.setPersist('ui.cherry_cloud.subscribe_prompt_seen', true)
    void this.runIntent(intent, details)
    return intent.completion.promise
  }

  private async runIntent(intent: SubscriptionIntent, details: { modelId?: string }): Promise<void> {
    let signingIn = false
    let scopeId: string | null = null
    try {
      const status = await ipcApi.request('cherry_cloud.status.get')
      scopeId = status.scopeId
      const signedIn = status.phase === 'signed-in'
      trackSubscriptionEvent(
        { event: 'subscription_entry_clicked', source: intent.source, flowId: intent.flowId, signedIn, ...details },
        scopeId
      )
      if (!this.isCurrentIntent(intent)) return
      if (signedIn) {
        await this.openPortal(intent, status.scopeId)
        return
      }
      signingIn = true
      const result = await ipcApi.request('cherry_cloud.login.start')
      if (!this.isCurrentIntent(intent)) return
      trackSubscriptionEvent(
        {
          event: 'subscription_sign_in_result',
          flowId: intent.flowId,
          result: result.outcome === 'signed-in' ? 'success' : 'not_completed'
        },
        result.status.scopeId
      )
      if (result.outcome === 'signed-in') await this.openPortal(intent, result.status.scopeId)
      else this.finishIntent(intent, { outcome: 'not_completed', reason: result.outcome })
    } catch (error) {
      if (!this.isCurrentIntent(intent)) return
      if (signingIn)
        trackSubscriptionEvent(
          {
            event: 'subscription_sign_in_result',
            flowId: intent.flowId,
            result: 'failed',
            reason: getCherryCloudSignInFailureReason(error)
          },
          scopeId
        )
      toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
      this.finishIntent(intent, { outcome: 'failed' })
    }
  }

  public dispose(): void {
    this.disposed = true
    if (this.intent && !this.intent.submitted)
      this.finishIntent(this.intent, { outcome: 'not_completed', reason: 'disposed' })
    this.intent = null
  }

  private isCurrentIntent(intent: SubscriptionIntent): boolean {
    return !this.disposed && this.intent === intent && !intent.finished
  }

  private finishIntent(intent: SubscriptionIntent, result: CherryCloudSubscribeOutcome): void {
    if (intent.finished) return
    intent.finished = true
    intent.completion.resolve(result)
  }

  private async openPortal(intent: SubscriptionIntent, scopeId: string): Promise<void> {
    if (!this.isCurrentIntent(intent) || intent.submitted) return
    intent.submitted = true
    try {
      const result = await openCherryCloudAccountPortal({ scopeId, entrySource: intent.source, flowId: intent.flowId })
      if (result.outcome === 'opened') {
        trackSubscriptionEvent(
          { event: 'subscription_portal_open', source: intent.source, flowId: intent.flowId, result: 'success' },
          scopeId
        )
        this.finishIntent(intent, { outcome: 'portal_invoked' })
      } else this.finishIntent(intent, { outcome: 'not_completed', reason: 'superseded' })
    } catch {
      trackSubscriptionEvent(
        { event: 'subscription_portal_open', source: intent.source, flowId: intent.flowId, result: 'failed' },
        scopeId
      )
      if (this.isCurrentIntent(intent)) toast.error(i18n.t('settings.subscription.open_portal_failed'))
      this.finishIntent(intent, { outcome: 'failed' })
    }
  }
}

export const cherryCloudSubscriptionService = new CherryCloudSubscriptionService()
window.addEventListener('unload', () => cherryCloudSubscriptionService.dispose(), { once: true })
