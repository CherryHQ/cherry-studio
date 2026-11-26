import useSWR from 'swr'

import { ipcApi } from '@renderer/ipc'

import { useCherryCloudReceipt } from './useCherryCloudReceipt'

/** The signed-in account's AMD activation state, re-read on window focus so a finished browser step shows up. */
export function useCherryCloudAmdStatus(enabled = true) {
  const { receipt } = useCherryCloudReceipt(enabled)
  const signedIn = receipt?.status.phase === 'signed-in'
  const scopeId = receipt?.status.scopeId
  const { data } = useSWR(
    enabled && signedIn && scopeId ? ['cherry-cloud/amd-status', scopeId] : null,
    () => ipcApi.request('cherry_cloud.amd_status.get'),
    { shouldRetryOnError: false, revalidateOnReconnect: false }
  )
  return data ?? undefined
}
