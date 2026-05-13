import { usePreference } from '@data/hooks/usePreference'
import { useEffect, useMemo } from 'react'

import { resolvePaintingProviderDefinition } from '../utils/paintingProviderMode'
import { resolvePaintingProvider } from '../utils/providerSelection'

const FALLBACK_PROVIDER = 'zhipu'

/**
 * Bootstrap the painting page's initial provider:
 * - resolve the preferred provider id from preference + currently available options
 * - persist the resolved id back to preference if it differs
 * - return the matching provider definition for seeding the first draft
 */
export function usePaintingInitialProvider(providerOptions: string[]) {
  const [defaultPaintingProvider, setDefaultPaintingProvider] = usePreference('feature.paintings.default_provider')

  const initialProviderId = useMemo(
    () =>
      resolvePaintingProvider(undefined, defaultPaintingProvider ?? undefined, providerOptions) ?? FALLBACK_PROVIDER,
    [defaultPaintingProvider, providerOptions]
  )

  const initialProviderDefinition = useMemo(
    () => resolvePaintingProviderDefinition(initialProviderId),
    [initialProviderId]
  )

  useEffect(() => {
    if (!defaultPaintingProvider) {
      void setDefaultPaintingProvider(initialProviderId)
    }
  }, [defaultPaintingProvider, initialProviderId, setDefaultPaintingProvider])

  return { initialProviderId, initialProviderDefinition }
}
