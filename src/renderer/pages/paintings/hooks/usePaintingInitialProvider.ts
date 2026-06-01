import { usePreference } from '@data/hooks/usePreference'
import { useEffect, useMemo } from 'react'

import { resolvePaintingProvider } from '../utils/providerSelection'

const FALLBACK_PROVIDER = 'zhipu'

/**
 * Bootstrap the painting page's initial provider id:
 * - resolve the preferred provider from preference + currently available options
 * - persist the resolved id back to preference if it differs
 */
export function usePaintingInitialProvider(providerOptions: string[]) {
  const [defaultPaintingProvider, setDefaultPaintingProvider] = usePreference('feature.paintings.default_provider')

  const initialProviderId = useMemo(
    () =>
      resolvePaintingProvider(undefined, defaultPaintingProvider ?? undefined, providerOptions) ?? FALLBACK_PROVIDER,
    [defaultPaintingProvider, providerOptions]
  )

  useEffect(() => {
    // Wait until provider options have loaded before persisting — otherwise
    // the first render persists the FALLBACK_PROVIDER the user never chose.
    if (!defaultPaintingProvider && providerOptions.length > 0) {
      void setDefaultPaintingProvider(initialProviderId)
    }
  }, [defaultPaintingProvider, initialProviderId, providerOptions, setDefaultPaintingProvider])

  return { initialProviderId }
}
