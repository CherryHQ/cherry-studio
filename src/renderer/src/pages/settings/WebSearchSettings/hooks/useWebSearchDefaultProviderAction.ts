import { getWebSearchProviderAvailability } from '@renderer/utils/webSearchProviders'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useCallback, useMemo } from 'react'

export function useWebSearchDefaultProviderAction(
  provider: ResolvedWebSearchProvider,
  capability: WebSearchCapability,
  defaultProvider: ResolvedWebSearchProvider | undefined,
  setDefaultProvider: (provider: ResolvedWebSearchProvider) => Promise<void>
) {
  const isDefault = defaultProvider?.id === provider.id
  const canSetAsDefault = useMemo(
    () => !isDefault && getWebSearchProviderAvailability(provider, capability).available,
    [capability, isDefault, provider]
  )

  const setAsDefault = useCallback(() => {
    if (canSetAsDefault) {
      void setDefaultProvider(provider)
    }
  }, [canSetAsDefault, provider, setDefaultProvider])

  return {
    isDefault,
    canSetAsDefault,
    onSetAsDefault: setAsDefault
  }
}
