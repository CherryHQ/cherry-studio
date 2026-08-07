import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import { useCallback } from 'react'

/** Persists provider enable changes and moves newly enabled providers to the top. */
export function useProviderEnable(providerId: string) {
  const { provider } = useProvider(providerId)
  const { updateProvider, enableProvider } = useProviderMutations(providerId)

  const toggleProviderEnabled = useCallback(
    async (enabled: boolean) => {
      if (!provider) {
        return
      }

      if (enabled) {
        await enableProvider()
        return
      }

      await updateProvider({ isEnabled: false })
    },
    [enableProvider, provider, updateProvider]
  )

  return {
    toggleProviderEnabled
  }
}
