import { useMemo } from 'react'
import useSWR from 'swr'

import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { ipcApi } from '@renderer/ipc'

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
