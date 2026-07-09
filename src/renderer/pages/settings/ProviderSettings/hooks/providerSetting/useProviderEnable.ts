import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import { useCallback } from 'react'

/** Persists provider enable changes and moves newly enabled providers to the top. */
export function useProviderEnable(providerId: string) {
  const { provider } = useProvider(providerId)
  const { updateProvider, enableProviderAndMoveToFirst } = useProviderMutations(providerId)

  const toggleProviderEnabled = useCallback(
    async (enabled: boolean) => {
      if (!provider) {
        return
      }

      if (enabled) {
        await enableProviderAndMoveToFirst()
        return
      }

      await updateProvider({ isEnabled: false })
    },
    [enableProviderAndMoveToFirst, provider, updateProvider]
  )

  return {
    toggleProviderEnabled
  }
}
