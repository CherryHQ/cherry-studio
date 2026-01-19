import { createSelector } from '@reduxjs/toolkit'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { getDefaultProvider } from '@renderer/services/AssistantService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addModel,
  addProvider,
  removeModel,
  removeProvider,
  updateModel,
  updateProvider,
  updateProviders
} from '@renderer/store/llm'
import type { Assistant, Model, Provider } from '@renderer/types'
import { isSystemProvider } from '@renderer/types'
import { withoutTrailingSlash } from '@renderer/utils/api'

import { useDefaultModel } from './useAssistant'

/**
 * Normalizes provider apiHost by removing trailing slashes.
 * This ensures consistent URL concatenation across the application.
 */
function normalizeProvider<T extends Provider>(provider: T): T {
  return {
    ...provider,
    apiHost: withoutTrailingSlash(provider.apiHost)
  }
}

const selectEnabledProviders = createSelector(
  (state) => state.llm.providers,
  (providers) =>
    providers
      .map(normalizeProvider)
      .filter((p) => p.enabled)
      .concat(CHERRYAI_PROVIDER)
)

export function useProviders() {
  const providers: Provider[] = useAppSelector(selectEnabledProviders)
  const dispatch = useAppDispatch()

  return {
    providers: providers || [],
    addProvider: (provider: Provider) => dispatch(addProvider(provider)),
    removeProvider: (provider: Provider) => dispatch(removeProvider(provider)),
    updateProvider: (updates: Partial<Provider> & { id: string }) => dispatch(updateProvider(updates)),
    updateProviders: (providers: Provider[]) => dispatch(updateProviders(providers))
  }
}

export function useSystemProviders() {
  return useAppSelector((state) => state.llm.providers.filter((p) => isSystemProvider(p)).map(normalizeProvider))
}

export function useUserProviders() {
  return useAppSelector((state) => state.llm.providers.filter((p) => !isSystemProvider(p)).map(normalizeProvider))
}

export function useAllProviders() {
  return useAppSelector((state) => state.llm.providers.map(normalizeProvider))
}

export function useProvider(id: string) {
  const provider =
    useAppSelector((state) =>
      state.llm.providers
        .concat([CHERRYAI_PROVIDER])
        .map(normalizeProvider)
        .find((p) => p.id === id)
    ) || getDefaultProvider()
  const dispatch = useAppDispatch()

  return {
    provider,
    models: provider?.models ?? [],
    updateProvider: (updates: Partial<Provider>) => dispatch(updateProvider({ id, ...updates })),
    addModel: (model: Model) => dispatch(addModel({ providerId: id, model })),
    removeModel: (model: Model) => dispatch(removeModel({ providerId: id, model })),
    updateModel: (model: Model) => dispatch(updateModel({ providerId: id, model }))
  }
}

export function useProviderByAssistant(assistant: Assistant) {
  const { defaultModel } = useDefaultModel()
  const model = assistant.model || defaultModel
  const { provider } = useProvider(model.provider)
  return provider
}
