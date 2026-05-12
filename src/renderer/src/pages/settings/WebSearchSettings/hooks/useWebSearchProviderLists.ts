import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { useMemo } from 'react'

import type { WebSearchProviderFeatureSection } from '../utils/webSearchProviderMeta'
import { getWebSearchFeatureSections } from '../utils/webSearchProviderMeta'

export function useWebSearchProviderLists(): ReturnType<typeof useWebSearchProviders> & {
  keywordProviders: WebSearchProvider[]
  fetchUrlsProviders: WebSearchProvider[]
  featureSections: WebSearchProviderFeatureSection[]
} {
  const webSearchProviders = useWebSearchProviders()
  const { providers } = webSearchProviders

  const providersByCapability = useMemo(() => {
    const keywordProviders: WebSearchProvider[] = []
    const fetchUrlsProviders: WebSearchProvider[] = []

    for (const provider of providers) {
      const features = new Set<WebSearchCapability>(provider.capabilities.map((capability) => capability.feature))
      if (features.has('searchKeywords')) {
        keywordProviders.push(provider)
      }
      if (features.has('fetchUrls')) {
        fetchUrlsProviders.push(provider)
      }
    }

    return { keywordProviders, fetchUrlsProviders }
  }, [providers])

  const featureSections = useMemo(() => getWebSearchFeatureSections(providers), [providers])

  return {
    ...webSearchProviders,
    ...providersByCapability,
    featureSections
  }
}
