import { useCallback, useState } from 'react'
import useSWR from 'swr'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { CherryCloudAccountReceipt, CherryCloudAccountRefreshResult } from '@shared/ipc/schemas/cherryCloud'

export const CHERRY_CLOUD_RECEIPT_KEY = 'cherry-cloud/account-receipt'

export function useCherryCloudReceipt(enabled = true) {
  const {
    data: receipt,
    error,
    mutate
  } = useSWR<CherryCloudAccountReceipt>(
    enabled ? CHERRY_CLOUD_RECEIPT_KEY : null,
    () => ipcApi.request('cherry_cloud.account.get'),
    { shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const applyReceipt = useCallback(
    (next: CherryCloudAccountReceipt) => {
      void mutate((current) => (!current || next.status.revision > current.status.revision ? next : current), {
        revalidate: false
      })
    },
    [mutate]
  )
  useIpcOn('cherry_cloud.account_changed', (next) => {
    if (enabled) applyReceipt(next)
  })
  const refresh = useCallback(
    async (reason: 'initial' | 'focus_refresh' = 'initial'): Promise<CherryCloudAccountRefreshResult> => {
      setIsRefreshing(true)
      try {
        const snapshot = receipt ?? (await ipcApi.request('cherry_cloud.account.get'))
        const result = await ipcApi.request('cherry_cloud.account.refresh', {
          scopeId: snapshot.status.scopeId,
          reason
        })
        if ('receipt' in result) applyReceipt(result.receipt)
        return result
      } finally {
        setIsRefreshing(false)
      }
    },
    [applyReceipt, receipt]
  )
  return { receipt, error, reload: mutate, refresh, isRefreshing, applyReceipt }
}
