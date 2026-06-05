import { useReorder } from '@data/hooks/useReorder'
import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import { useCallback } from 'react'

/** Persists provider enable changes and moves newly enabled providers to the top. */
export function useProviderEnable(providerId: string) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const { move } = useReorder('/providers')

  const toggleProviderEnabled = useCallback(
    async (enabled: boolean) => {
      if (!provider) {
        return
      }

      const previousEnabled = provider.isEnabled
      await updateProvider({ isEnabled: enabled })

      if (!enabled) {
        return
      }

      try {
        await move(providerId, { position: 'first' })
      } catch (error) {
        // Enable + pin-to-top is one user-facing action. If pinning fails after the
        // enable already committed, roll the enable state back so we don't leave a
        // half-success ("enabled but not pinned") with no path back. Best-effort —
        // if the rollback also fails the original error still surfaces.
        await updateProvider({ isEnabled: previousEnabled }).catch(() => undefined)
        throw error
      }
    },
    [move, provider, providerId, updateProvider]
  )

  return {
    toggleProviderEnabled
  }
}
