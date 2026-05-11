import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useMemo } from 'react'

import type { WebSearchProviderFeatureSection } from '../utils/webSearchProviderMeta'
import { getWebSearchFeatureSections } from '../utils/webSearchProviderMeta'

export function useWebSearchProviderLists(): ReturnType<typeof useWebSearchProviders> & {
  keywordProviders: ResolvedWebSearchProvider[]
  fetchUrlsProviders: ResolvedWebSearchProvider[]
  featureSections: WebSearchProviderFeatureSection[]
  providerIds: string[]
} {
  const webSearchProviders = useWebSearchProviders()
  const { providers } = webSearchProviders

  const providersByCapability = useMemo(() => {
    const keywordProviders: ResolvedWebSearchProvider[] = []
    const fetchUrlsProviders: ResolvedWebSearchProvider[] = []

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

  const providerIds = useMemo(() => providers.map((provider) => provider.id), [providers])

  return {
    ...webSearchProviders,
    ...providersByCapability,
    featureSections,
    providerIds
  }
}
