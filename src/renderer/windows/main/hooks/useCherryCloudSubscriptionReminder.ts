import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { useCherryCloudReceipt } from '@renderer/hooks/useCherryCloudReceipt'
import { subscribeClickAttribution, trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'

/** One quiet baseline per account scope; only fresh subsequent plan transitions are announced. */
export function useCherryCloudSubscriptionReminder(): void {
  const { t } = useTranslation()
  const { session, activePaid } = useCherryCloudPlans()
  const { receipt, refresh } = useCherryCloudReceipt()
  const last = useRef<{ scopeId: string; paidId: string | null; observedRevision: number } | null>(null)
  useEffect(() => {
    if (session.status?.phase !== 'signed-in') return
    const onFocus = () => {
      void refresh('focus_refresh').catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh, session.status?.phase])
  useEffect(() => {
    if (!receipt || receipt.status.phase !== 'signed-in') {
      last.current = null
      return
    }
    const status = receipt.status
    const plans = receipt.plans
    if (plans.freshness !== 'fresh') return
    const previous = last.current
    if (previous?.scopeId === status.scopeId && previous.observedRevision === plans.observedRevision) return
    const paidId = activePaid?.id ?? null
    last.current = { scopeId: status.scopeId, paidId, observedRevision: plans.observedRevision }
    if (previous?.scopeId !== status.scopeId || previous.paidId !== null || !activePaid) return
    if (receipt.reason === 'focus_refresh' || receipt.reason === 'notification') {
      trackSubscriptionEvent(
        {
          event: 'subscription_entitlement_refresh_result',
          result: 'succeeded',
          planId: activePaid.plan.id,
          detectedBy: receipt.reason,
          ...subscribeClickAttribution()
        },
        status.scopeId
      )
    }
    toast.success(t('settings.subscription.activated', { plan: activePaid.plan.display_name }))
  }, [activePaid, receipt, t])
}
