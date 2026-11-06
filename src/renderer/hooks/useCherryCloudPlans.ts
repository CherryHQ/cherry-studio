import { useMemo } from 'react'
import useSWR from 'swr'

import { usePersistCache } from '@data/hooks/useCache'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

/** The signed-in account's plans; the active paid entitlement decides every subscription touchpoint. */
export function useCherryCloudPlans(enabled = true) {
  const session = useCherryAccountSession(enabled)
  const accountId = session.status?.phase === 'signed-in' ? session.status.accountId : null
  // Keyed by account: a response for a previous account only ever lands in that account's cache entry.
  const plansQuery = useSWR(enabled && accountId ? ['cherry-cloud/account-plans', accountId] : null, () =>
    ipcApi.request('cherry_cloud.account_plans.get')
  )
  const activePaid = useMemo(
    () => plansQuery.data?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free),
    [plansQuery.data]
  )

  return { session, plansQuery, activePaid }
}

/**
 * Whether to mark the Subscribe entries with a red dot: China edition only, until any Subscribe
 * touchpoint is used, and never for a paying account.
 */
export function useCherryCloudSubscribeReminder(): boolean {
  const [subscribePromptSeen] = usePersistCache('ui.cherry_cloud.subscribe_prompt_seen')
  const remindToSubscribe = getAppEdition() === 'cn' && !subscribePromptSeen
  const { session, plansQuery, activePaid } = useCherryCloudPlans(remindToSubscribe)
  // Wait for the plans of a signed-in account so a paying user never sees the dot flash.
  return remindToSubscribe && (session.status?.phase === 'signed-out' || (plansQuery.data !== undefined && !activePaid))
}
