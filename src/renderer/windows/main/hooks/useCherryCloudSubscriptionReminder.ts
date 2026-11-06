import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'

import { CHERRY_CLOUD_AVAILABILITY_KEY } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { useIpcOn } from '@renderer/ipc'
import { subscribeClickAttribution, trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'

// A plans change this soon after main's notification-driven refresh came from that notification.
const NOTIFICATION_REFRESH_WINDOW_MS = 15_000

/**
 * Show one light toast when the signed-in account gains a paid entitlement it did not have, e.g.
 * after a web checkout. Plans refetch when the window regains focus on return from the browser, and
 * any paid entitlement change refetches model availability so the plan's models unlock right away.
 * A China-edition subscription notification refetches both as soon as main has refreshed the account.
 * Main-only, mounted once from `MainWindowRuntime`.
 */
export function useCherryCloudSubscriptionReminder(): void {
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()
  const { session, plansQuery, activePaid } = useCherryCloudPlans()
  const accountId = session.status?.phase === 'signed-in' ? session.status.accountId : null
  const lastSnapshotRef = useRef<{ accountId: string; paidEntitlementId: string | null } | null>(null)
  // After a sign-out the plans cached for the account predate it; the next baseline waits until a
  // revalidation has started and finished, so a purchase made while signed out is not announced.
  const freshPlansRef = useRef<'ready' | 'awaiting' | 'revalidating'>('ready')
  const notificationRefreshAtRef = useRef(0)

  useIpcOn('cherry_cloud.account_refreshed', () => {
    notificationRefreshAtRef.current = Date.now()
    void plansQuery.mutate()
    void mutate(CHERRY_CLOUD_AVAILABILITY_KEY)
  })

  useEffect(() => {
    if (!accountId) {
      // Only a session that ended; a status still loading at startup has no cached plans to distrust.
      if (lastSnapshotRef.current) freshPlansRef.current = 'awaiting'
      lastSnapshotRef.current = null
      return
    }
    if (freshPlansRef.current !== 'ready') {
      if (plansQuery.isValidating) freshPlansRef.current = 'revalidating'
      if (plansQuery.isValidating || freshPlansRef.current === 'awaiting') return
      // A failed revalidation leaves the pre-sign-out plans in place; wait for one that succeeds.
      if (plansQuery.error) {
        freshPlansRef.current = 'awaiting'
        return
      }
      freshPlansRef.current = 'ready'
    }
    if (!plansQuery.data) return
    const paidEntitlementId = activePaid?.id ?? null
    const previous = lastSnapshotRef.current
    lastSnapshotRef.current = { accountId, paidEntitlementId }
    // Only a change seen on the same account counts; signing into a paid account is not a purchase.
    if (previous?.accountId !== accountId || previous.paidEntitlementId === paidEntitlementId) return
    void mutate(CHERRY_CLOUD_AVAILABILITY_KEY)
    if (activePaid && previous.paidEntitlementId === null) {
      trackSubscriptionEvent({
        event: 'subscription_entitlement_refresh_result',
        result: 'succeeded',
        planId: activePaid.plan.id,
        detectedBy:
          Date.now() - notificationRefreshAtRef.current < NOTIFICATION_REFRESH_WINDOW_MS
            ? 'notification'
            : 'focus_refresh',
        ...subscribeClickAttribution()
      })
      toast.success(t('settings.subscription.activated', { plan: activePaid.plan.display_name }))
    }
  }, [accountId, activePaid, mutate, plansQuery.data, plansQuery.error, plansQuery.isValidating, t])
}
