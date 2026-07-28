import { loggerService } from '@logger'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProvider'
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
  const previousHasServerApiKeyRef = useRef(new Map<string, boolean>())
  const hasServerApiKey = apiKeysData
    ? apiKeysData.keys.some((item) => item.isEnabled && item.key.trim().length > 0)
    : undefined

  useEffect(() => {
    if (!isOnboarding || !provider || hasServerApiKey === undefined) {
      return
    }

    const previousHasServerApiKey = previousHasServerApiKeyRef.current.get(provider.id)
    previousHasServerApiKeyRef.current.set(provider.id, hasServerApiKey)

    if (provider.isEnabled || !hasServerApiKey || previousHasServerApiKey !== false) {
      return
    }

    void updateProvider({ isEnabled: true }).catch((error) => {
      logger.error('Failed to auto-enable onboarding provider', { providerId: provider.id, error })
    })
  }, [hasServerApiKey, isOnboarding, provider, updateProvider])
}
