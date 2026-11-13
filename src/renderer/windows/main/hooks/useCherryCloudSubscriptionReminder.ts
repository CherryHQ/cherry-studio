import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { useCherryCloudReceipt } from '@renderer/hooks/useCherryCloudReceipt'
import { ipcApi } from '@renderer/ipc'
import { subscribeClickAttribution, trackSubscriptionEvent } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountPlans, CherryCloudAccountReceipt } from '@shared/ipc/schemas/cherryCloud'

export interface CherryCloudPlanActivation {
  /** Chat models granted by the plan that are already synced locally, in plan order. */
  modelIds: UniqueModelId[]
  expiresAt: string | null
}

/** One quiet baseline per account scope; only fresh subsequent plan transitions are announced. */
export function useCherryCloudSubscriptionReminder(): {
  activation: CherryCloudPlanActivation | null
  dismiss: () => void
} {
  const { t } = useTranslation()
  const { session, activePaid } = useCherryCloudPlans()
  const { receipt, refresh } = useCherryCloudReceipt()
  const [activation, setActivation] = useState<CherryCloudPlanActivation | null>(null)
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
    const modelIds = availablePlanModelIds(activePaid, receipt)
    const expiresAt = activePaid.expires_at ?? null
    const message = t('settings.subscription.activated', { plan: activePaid.plan.display_name })
    // While the China notification stream is live, the notification center announces the change instead.
    void notificationsAnnounceChanges().then((announced) => {
      if (announced) return
      if (modelIds.length > 0) setActivation({ modelIds, expiresAt })
      else toast.success(message)
    })
  }, [activePaid, receipt, t])
  const dismiss = useCallback(() => setActivation(null), [])
  return { activation, dismiss }
}

function availablePlanModelIds(
  entitlement: CherryCloudAccountPlans['entitlements'][number],
  receipt: CherryCloudAccountReceipt
) {
  if (receipt.models.freshness === 'unknown') return []
  const available = new Set(receipt.models.value.availableModelIds.general)
  const planModelIds = entitlement.plan.models?.length
    ? entitlement.plan.models.filter((model) => model.available_features.includes('chat')).map((model) => model.id)
    : entitlement.quota_pools.flatMap((pool) => pool.model_ids)
  const ids = planModelIds.map((id) => createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, id))
  return [...new Set(ids)].filter((id) => available.has(id))
}

async function notificationsAnnounceChanges(): Promise<boolean> {
  if (getAppEdition() !== 'cn') return false
  return ipcApi.request('cherry_cloud.notifications.active.get').catch(() => false)
}
