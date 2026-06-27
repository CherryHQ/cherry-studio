import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { codeCLI } from '@shared/types/codeCli'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { useCallback, useMemo } from 'react'

import { CLI_TOOL_PROVIDER_MAP } from './cliTools'

/**
 * Provider/model resolution for the code-CLI page: builds the per-tool provider
 * allowlist, the model filter handed to the edit panel's `ModelSelector`, and a
 * display-name resolver for the config list.
 */
export function useConfigMetadata(selectedCliTool: codeCLI) {
  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const { models: allModels } = useModels({ enabled: true })
  const modelById = useMemo(() => new Map(allModels.map((m) => [m.id, m])), [allModels])

  const allowedProviderIds = useMemo(() => {
    const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
    const allowed = filterFn ? filterFn(providers) : []
    return new Set(allowed.map((p) => p.id))
  }, [providers, selectedCliTool])

  const modelFilter = useCallback(
    (model: Model) => {
      if (isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) return false
      return providerMap.has(model.providerId) && allowedProviderIds.has(model.providerId)
    },
    [providerMap, allowedProviderIds]
  )

  const resolveConfigMeta = useCallback(
    (config: CliNamedConfig) => {
      if (!isUniqueModelId(config.modelId)) return { providerName: undefined, modelName: undefined }
      const { providerId, modelId: rawId } = parseUniqueModelId(config.modelId)
      const provider = providerMap.get(providerId)
      const model = modelById.get(config.modelId)
      return {
        providerName: provider ? getProviderDisplayName(provider) : providerId,
        modelName: model?.name || rawId
      }
    },
    [providerMap, modelById]
  )

  return { modelFilter, resolveConfigMeta }
}
