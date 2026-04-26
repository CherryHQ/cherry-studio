import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProviders'
import { useEffect } from 'react'

interface UseProviderOnboardingAutoEnableParams {
  providerId: string
  isOnboarding: boolean
}

/**
 * This is a coordination effect hook, not a domain-cohesive state hook.
 * Boundary rule: it may read across onboarding and provider state internally,
 * but it should still minimize inputs and internalize its own cross-domain reads where practical.
 * It must own exactly one cross-domain side effect, return no wide object, and never become a facade/view-model.
 *
 * Intent: auto-enable a provider during onboarding once the server truth confirms an API key exists.
 * Scope: use once at the Provider Settings page composition layer for onboarding-specific behavior.
 * Does not handle: API key input state, popup flows, or generic provider enable/disable actions.
 *
 * @example
 * ```tsx
 * useProviderOnboardingAutoEnable({ providerId, isOnboarding })
 * ```
 */
export function useProviderOnboardingAutoEnable({ providerId, isOnboarding }: UseProviderOnboardingAutoEnableParams) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const hasServerApiKey = (apiKeysData?.keys?.some((item) => item.isEnabled && item.key.trim()) ?? false) === true

  useEffect(() => {
    if (!isOnboarding || !provider || provider.isEnabled) {
      return
    }

    if (!hasServerApiKey) {
      return
    }

    void updateProvider({ isEnabled: true })
  }, [hasServerApiKey, isOnboarding, provider, updateProvider])
}
