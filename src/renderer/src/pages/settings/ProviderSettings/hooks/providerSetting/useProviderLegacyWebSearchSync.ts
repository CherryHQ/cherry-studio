import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import { useAppDispatch } from '@renderer/store'
import { useEffect } from 'react'

import { applyProviderApiKeySideEffects } from '../../adapters/providerSettingsSideEffects'

/**
 * This is a coordination effect hook, not a domain-cohesive state hook.
 * Boundary rule: it may read across provider settings and legacy Redux state internally,
 * but it should still minimize inputs and keep bridge logic out of domain-cohesive hooks.
 * It must own exactly one cross-domain side effect, return no wide object, and never become a facade/view-model.
 *
 * Intent: isolate the temporary v2 -> legacy websearch bridge for providers that still mirror API keys into Redux state.
 * Scope: use once at the Provider Settings page composition layer while legacy websearch state remains in the app.
 * Does not handle: API key editing, persistence, or any non-legacy provider side effects.
 *
 * @example
 * ```tsx
 * useProviderLegacyWebSearchSync(providerId)
 * ```
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
