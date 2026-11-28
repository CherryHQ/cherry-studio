import { useMemo } from 'react'

import type { CodeCliToolState } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'

interface UseSortedSupportedProvidersOptions {
  providers: Provider[]
  currentToolState: CodeCliToolState
  filterProviders: (providers: Provider[]) => Provider[]
  prependedProviders?: Provider[]
}

export function useSortedSupportedProviders({
  providers,
  currentToolState,
  filterProviders,
  prependedProviders
}: UseSortedSupportedProvidersOptions): Provider[] {
  return useMemo(() => {
    const filtered = prependedProviders?.length
      ? [...prependedProviders, ...filterProviders(providers)]
      : filterProviders(providers)
    const entries = new Map(Object.entries(currentToolState.providers))
    return filtered
      .map((provider, index) => ({
        provider,
        index,
        sortIndex: entries.get(provider.id)?.sortIndex
      }))
      .sort((a, b) => {
        if (a.sortIndex !== undefined && b.sortIndex !== undefined && a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex
        }
        if (a.sortIndex !== undefined && b.sortIndex === undefined) return -1
        if (a.sortIndex === undefined && b.sortIndex !== undefined) return 1
        return a.index - b.index
      })
      .map(({ provider }) => provider)
  }, [filterProviders, providers, currentToolState, prependedProviders])
}
