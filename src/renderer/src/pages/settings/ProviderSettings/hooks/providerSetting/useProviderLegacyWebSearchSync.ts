import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import { useAppDispatch } from '@renderer/store'
import { useEffect } from 'react'

import { applyProviderApiKeySideEffects } from '../../utils/providerSettingsSideEffects'

/**
 * Transitional bridge: mirrors provider API keys into the legacy websearch
 * store while that consumer still reads old state instead of Data API provider
 * data. Remove after websearch stops depending on the legacy store adapter.
 */
export function useProviderLegacyWebSearchSync(providerId: string) {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const dispatch = useAppDispatch()
  const serverApiKey =
    apiKeysData?.keys
      ?.filter((item) => item.isEnabled)
      .map((item) => item.key)
      .join(',') ?? ''

  useEffect(() => {
    if (!provider || !serverApiKey) {
      return
    }

    applyProviderApiKeySideEffects({
      providerId: provider.id,
      apiKey: serverApiKey,
      dispatch
    })
  }, [dispatch, provider, serverApiKey])
}
