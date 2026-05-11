import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import { useAppDispatch } from '@renderer/store'
import { useEffect } from 'react'

import { applyProviderApiKeySideEffects } from '../../utils/providerSettingsSideEffects'

/** Mirrors provider API keys into legacy websearch state while that bridge still exists. */
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
