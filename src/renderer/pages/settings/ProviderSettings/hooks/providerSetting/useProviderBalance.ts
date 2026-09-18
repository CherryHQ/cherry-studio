import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import type { ProviderBalance } from '@shared/data/types/providerBalance'
import type { IpcError } from '@shared/ipc/errors/IpcError'
import useSWR from 'swr'

export function useProviderBalance(providerId: string, keyId: string | undefined) {
  const { provider } = useProvider(providerId)
  const enabled = provider?.supportsBalance || (!provider?.presetProviderId && provider?.settings.balanceQuery?.enabled)
  return useSWR<ProviderBalance, IpcError>(
    enabled && keyId && provider?.authType === 'api-key'
      ? ['provider.balance', providerId, keyId, provider.updatedAt]
      : null,
    () => ipcApi.request('provider.balance.get', { providerId, keyId: keyId! }),
    {
      keepPreviousData: false,
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      refreshInterval: 0
    }
  )
}
