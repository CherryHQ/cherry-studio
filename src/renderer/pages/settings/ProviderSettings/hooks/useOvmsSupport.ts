import useSWRImmutable from 'swr/immutable'

import { ipcApi } from '@renderer/ipc'

async function loadOvmsSupport(): Promise<boolean> {
  try {
    return await ipcApi.request('ovms.is_supported')
  } catch {
    return false
  }
}

export function useOvmsSupport() {
  const { data } = useSWRImmutable('ovms/isSupported', loadOvmsSupport)

  return { isSupported: data }
}
