import { useReorder } from '@data/hooks/useReorder'
import { useProvider, useProviderMutations } from '@renderer/hooks/useProviders'
import { useCallback } from 'react'

/**
 * Intent: own provider enable/disable persistence and the enable-to-top reorder side effect.
 * Scope: use where Provider Settings needs the header-level enable toggle behavior.
 * Does not handle: endpoint persistence, API key editing, or onboarding auto-enable.
 *
 * @example
 * ```tsx
 * const { toggleProviderEnabled } = useProviderEnable(providerId)
 * <Switch checked={provider.isEnabled} onCheckedChange={(enabled) => void toggleProviderEnabled(enabled)} />
 * ```
 */
export function useProviderEnable(providerId: string) {
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const { move } = useReorder('/providers')

  const toggleProviderEnabled = useCallback(
    async (enabled: boolean) => {
      if (!provider) {
        return
      }

      await updateProvider({ isEnabled: enabled })

      if (enabled) {
        await move(providerId, { position: 'first' })
      }
    },
    [move, provider, providerId, updateProvider]
  )

  return {
    toggleProviderEnabled
  }
}
