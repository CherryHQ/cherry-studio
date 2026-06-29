import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName } from '@renderer/hooks/useProvider'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { isCherryAIProvider } from '@shared/utils/provider'
import { useCallback, useMemo } from 'react'

import { CLI_TOOL_PROVIDER_MAP } from './cliTools'

/**
 * Provider/model resolution for the code-CLI page: builds the per-tool enabled
 * provider list, the model filter handed to the edit panel's `ModelSelector`,
 * and a display-name resolver for the provider list.
 */
export function useConfigMetadata(selectedCliTool: CodeCli) {
  const { models: allModels } = useModels({ enabled: true })
  const modelById = useMemo(() => new Map(allModels.map((m) => [m.id, m])), [allModels])
  const firstModelByProvider = useMemo(() => {
    const map = new Map<string, UniqueModelId>()
    for (const model of allModels) {
      if (isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) continue
      if (!map.has(model.providerId)) map.set(model.providerId, model.id as UniqueModelId)
    }
    return map
  }, [allModels])

  const filterProviders = useCallback(
    (providers: Provider[]): Provider[] => {
      const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
      return filterFn ? filterFn(providers).filter((p) => p.isEnabled && !isCherryAIProvider(p)) : []
    },
    [selectedCliTool]
  )

  /** Build a model filter scoped to one provider (for the edit panel's picker). */
  const makeModelFilter = useCallback(
    (providerId: string) =>
      (model: Model): boolean => {
        if (isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) return false
        return model.providerId === providerId
      },
    []
  )

  const resolveProviderMeta = useCallback(
    (provider: Provider, providerConfig?: CliProviderConfig) => {
      const modelId = providerConfig?.modelId ?? firstModelByProvider.get(provider.id)
      let modelName: string | undefined
      if (modelId && isUniqueModelId(modelId)) {
        const model = modelById.get(modelId)
        const { modelId: rawId } = parseUniqueModelId(modelId)
        modelName = model?.name || rawId
      }
      return {
        providerName: getProviderDisplayName(provider),
        modelName
      }
    },
    [modelById, firstModelByProvider]
  )

  return { filterProviders, makeModelFilter, resolveProviderMeta, firstModelByProvider }
}
