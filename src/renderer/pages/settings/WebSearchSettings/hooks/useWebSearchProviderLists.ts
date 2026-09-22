import { useMemo } from 'react'

import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import type { WebSearchProviderFeatureSection } from '@renderer/utils/webSearchProviderMeta'
import { getWebSearchFeatureSections } from '@renderer/utils/webSearchProviderMeta'

export function useWebSearchProviderLists(): ReturnType<typeof useWebSearchProviders> & {
  featureSections: WebSearchProviderFeatureSection[]
} {
  const webSearchProviders = useWebSearchProviders()
  const { providers } = webSearchProviders
  const featureSections = useMemo(() => getWebSearchFeatureSections(providers), [providers])

  return {
    ...webSearchProviders,
    featureSections
  }
}
