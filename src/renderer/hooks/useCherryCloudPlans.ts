import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

import { usePersistCache } from '@data/hooks/useCache'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { useCherryCloudReceipt } from '@renderer/hooks/useCherryCloudReceipt'
import { getAppEdition } from '@renderer/utils/appEdition'

/** Plans preserve last-known paid display; current entitlement decisions also require isPlansReady. */
export function useCherryCloudPlans(enabled = true) {
  const session = useCherryAccountSession(enabled)
  const { receipt, refresh, isRefreshing } = useCherryCloudReceipt(enabled)
  const scopeId = session.status?.phase === 'signed-in' ? session.status.scopeId : null
  const initial = useSWR(
    enabled && scopeId ? ['cherry-cloud/account-initial', scopeId] : null,
    () => refresh('initial'),
    { shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  const fact = receipt?.status.scopeId === scopeId ? receipt.plans : undefined
  const plansFreshness = fact?.freshness ?? 'unknown'
  const isPlansReady = plansFreshness === 'fresh'
  const data = fact && fact.freshness !== 'unknown' ? fact.value : undefined
  const error = useMemo(
    () => (fact && fact.freshness !== 'fresh' && fact.error ? new Error(fact.error) : initial.error),
    [fact, initial.error]
  )
  const mutate = useCallback(() => refresh('focus_refresh'), [refresh])
  const activePaid = useMemo(
    () => data?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free),
    [data]
  )
  const upcomingPaid = useMemo(
    () => data?.entitlements.find((item) => item.state === 'upcoming' && !item.plan.is_free),
    [data]
  )
  const plansQuery = {
    data,
    error,
    isLoading: Boolean(scopeId && !data && !error),
    isValidating: initial.isValidating || isRefreshing,
    mutate
  }
  return { session, plansQuery, activePaid, upcomingPaid, isPlansReady, plansFreshness }
}

/** China-edition Subscribe dot, quiet while current-account plans are unknown. */
export function useCherryCloudSubscribeReminder(): boolean {
  const [subscribePromptSeen] = usePersistCache('ui.cherry_cloud.subscribe_prompt_seen')
  const remindToSubscribe = getAppEdition() === 'cn' && !subscribePromptSeen
  const { session, isPlansReady, activePaid, upcomingPaid } = useCherryCloudPlans(remindToSubscribe)
  return remindToSubscribe && (session.status?.phase === 'signed-out' || (isPlansReady && !activePaid && !upcomingPaid))
}
