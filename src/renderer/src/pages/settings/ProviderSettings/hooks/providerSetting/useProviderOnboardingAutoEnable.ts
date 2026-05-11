import { loggerService } from '@logger'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProviders'
import { useEffect, useRef } from 'react'

interface UseProviderOnboardingAutoEnableParams {
  providerId: string
  isOnboarding: boolean
}

/** Auto-enables a provider during onboarding once the server confirms an API key exists. */
const logger = loggerService.withContext('ProviderSettings:OnboardingAutoEnable')

export function useProviderOnboardingAutoEnable({ providerId, isOnboarding }: UseProviderOnboardingAutoEnableParams) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const autoEnableDispatchedProviderIdRef = useRef<string | null>(null)
  const hasServerApiKey = (apiKeysData?.keys?.some((item) => item.isEnabled && item.key.trim()) ?? false) === true

  useEffect(() => {
    if (provider?.isEnabled && autoEnableDispatchedProviderIdRef.current === provider.id) {
      autoEnableDispatchedProviderIdRef.current = null
    }

    if (!isOnboarding || !provider || provider.isEnabled) {
      return
    }

    if (!hasServerApiKey) {
      return
    }

    if (autoEnableDispatchedProviderIdRef.current === provider.id) {
      return
    }

    autoEnableDispatchedProviderIdRef.current = provider.id
    void updateProvider({ isEnabled: true }).catch((error) => {
      logger.error('Failed to auto-enable onboarding provider', { providerId: provider.id, error })
      autoEnableDispatchedProviderIdRef.current = null
    })
  }, [hasServerApiKey, isOnboarding, provider, updateProvider])
}
