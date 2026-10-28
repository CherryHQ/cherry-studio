import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { toast } from '@renderer/services/toast'

/**
 * Show one light toast when the signed-in account gains a paid entitlement it did not have, e.g.
 * after a web checkout. Plans refetch when the window regains focus on return from the browser.
 * Main-only, mounted once from `MainWindowRuntime`.
 */
export function useCherryCloudSubscriptionReminder(): void {
  const { t } = useTranslation()
  const { session, plansQuery, activePaid } = useCherryCloudPlans()
  const accountId = session.status?.phase === 'signed-in' ? session.status.accountId : null
  const lastSnapshotRef = useRef<{ accountId: string; paidEntitlementId: string | null } | null>(null)

  useEffect(() => {
    if (!accountId || !plansQuery.data) return
    const paidEntitlementId = activePaid?.id ?? null
    const previous = lastSnapshotRef.current
    lastSnapshotRef.current = { accountId, paidEntitlementId }
    // Only a change seen on the same account counts; signing into a paid account is not a purchase.
    if (activePaid && previous?.accountId === accountId && previous.paidEntitlementId === null) {
      toast.success(t('settings.subscription.activated', { plan: activePaid.plan.display_name }))
    }
  }, [accountId, activePaid, plansQuery.data, t])
}
