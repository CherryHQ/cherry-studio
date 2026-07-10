import type { CodeCliToolState } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'
import { useCallback, useMemo, useState } from 'react'

interface UseSortedSupportedProvidersOptions {
  providers: Provider[]
  currentToolState: CodeCliToolState
  selectedCliTool: CodeCli
  filterProviders: (providers: Provider[]) => Provider[]
  reorderProviders: (providerIds: string[]) => Promise<void>
  onReorderError: (error: unknown) => void
  /** Synthetic "own login" entry to include in the list (login-capable tools only). */
  ownLoginProvider?: Provider | null
}

export function useSortedSupportedProviders({
  providers,
  currentToolState,
  selectedCliTool,
  filterProviders,
  reorderProviders,
  onReorderError,
  ownLoginProvider
}: UseSortedSupportedProvidersOptions): {
  supportedProviders: Provider[]
  onReorder: (nextProviders: Provider[]) => Promise<void>
} {
  const [optimisticProviderOrder, setOptimisticProviderOrder] = useState<{ toolId: CodeCli; ids: string[] } | null>(
    null
  )

  const supportedProviders = useMemo(() => {
    // The synthetic own-login entry is prepended so it sorts/reorders alongside real providers.
    const filtered = ownLoginProvider ? [ownLoginProvider, ...filterProviders(providers)] : filterProviders(providers)
    const entries = new Map(Object.entries(currentToolState.providers))
    const baseSorted = [...filtered]
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

    const orderedIds = optimisticProviderOrder?.toolId === selectedCliTool ? optimisticProviderOrder.ids : null
    if (!orderedIds) return baseSorted

    const optimisticIndex = new Map(orderedIds.map((id, index) => [id, index]))
    const stableIndex = new Map(baseSorted.map((provider, index) => [provider.id, index]))
    return [...baseSorted].sort((a, b) => {
      const ai = optimisticIndex.get(a.id)
      const bi = optimisticIndex.get(b.id)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return (stableIndex.get(a.id) ?? 0) - (stableIndex.get(b.id) ?? 0)
    })
  }, [filterProviders, providers, currentToolState, optimisticProviderOrder, selectedCliTool, ownLoginProvider])

  const handleReorder = useCallback(
    async (nextProviders: Provider[]) => {
      const orderedIds = nextProviders.map((p) => p.id)
      setOptimisticProviderOrder({ toolId: selectedCliTool, ids: orderedIds })
      try {
        await reorderProviders(orderedIds)
      } catch (error) {
        setOptimisticProviderOrder(null)
        onReorderError(error)
        throw error
      }
    },
    [onReorderError, reorderProviders, selectedCliTool]
  )

  return {
    supportedProviders,
    onReorder: handleReorder
  }
}
