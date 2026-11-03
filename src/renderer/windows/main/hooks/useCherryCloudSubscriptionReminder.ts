import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'

import { CHERRY_CLOUD_AVAILABILITY_KEY } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { toast } from '@renderer/services/toast'

/**
 * Show one light toast when the signed-in account gains a paid entitlement it did not have, e.g.
 * after a web checkout. Plans refetch when the window regains focus on return from the browser, and
 * any paid entitlement change refetches model availability so the plan's models unlock right away.
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
      toast.success(t('settings.subscription.activated', { plan: activePaid.plan.display_name }))
    }
  }, [accountId, activePaid, mutate, plansQuery.data, plansQuery.isValidating, t])
}
