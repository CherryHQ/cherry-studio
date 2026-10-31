import { useCallback, useMemo } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName } from '@renderer/hooks/useProvider'
import { getClaudeContextModelId, hasClaudeDetailedModels } from '@renderer/services/codeCliConfig'
import {
  filterCliProviders,
  isCliChatModel,
  getGatewayProviderIds,
  isCliGatewayModel
} from '@renderer/services/codeCliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'

/**
 * Provider/model resolution for the code-CLI page: builds the per-tool enabled
 * provider list, the model filter handed to the edit panel's `ModelSelector`,
 * and a display-name resolver for the provider list.
 */
export function useConfigMetadata(selectedCliTool: CodeCli, providers: Provider[], isProvidersLoading = false) {
  const { models: allModels, isLoading: isModelsLoading, refetch: refreshModels } = useModels({ enabled: true })
  const [defaultModelId] = usePreference('chat.default_model_id')
  // `gatewayModelsById` is built from both queries, and each yields an empty list while in flight —
  // indistinguishable from "no routable model exists". Expose the combined flag so callers that
  // resolve gateway addresses can wait instead of reading a cold map as an answer.
  const isGatewayModelsLoading = isModelsLoading || isProvidersLoading
  const modelById = useMemo(() => new Map(allModels.map((m) => [m.id, m])), [allModels])
  const gatewayProviderIds = useMemo(() => getGatewayProviderIds(providers), [providers])
  const gatewayModelsById = useMemo(
    () =>
      new Map(
        allModels.filter((model) => isCliGatewayModel(gatewayProviderIds, model)).map((model) => [model.id, model])
      ),
    [allModels, gatewayProviderIds]
  )
  const defaultGatewayModelId =
    defaultModelId && gatewayModelsById.has(defaultModelId as Model['id']) ? (defaultModelId as Model['id']) : undefined

  const filterProviders = useCallback(
    (providers: Provider[]): Provider[] => filterCliProviders(selectedCliTool, providers),
    [selectedCliTool]
  )

  /** Build a model filter scoped to one provider (for the edit panel's picker). */
  const makeModelFilter = useCallback(
    (providerId: string) =>
      (model: Model): boolean => {
        // The gateway does dialect conversion, so any chat model of any enabled provider is usable
        // regardless of the CLI tool — drop the per-tool endpoint gate and the single-provider scope,
        // keeping only what Code Mate may route through the gateway. Cherry Cloud does not expose
        // a Code Mate feature entitlement, so its managed models are never offered here.
        if (isApiGatewayProviderId(providerId)) {
          return isCliGatewayModel(gatewayProviderIds, model)
        }
        return model.providerId === providerId && isCliChatModel(selectedCliTool, model)
      },
    [gatewayProviderIds, selectedCliTool]
  )

  const resolveProviderMetaForTool = useCallback(
    (toolId: CodeCli, provider: Provider, providerConfig?: CliProviderConfig) => {
      const config = providerConfig?.config ?? {}
      // Detailed Claude configs carry no top-level modelId; surface the primary
      // (fable-role) detailed model instead of hiding the model entirely.
      const modelId =
        toolId === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config)
          ? getClaudeContextModelId(
              provider.id,
              config,
              isApiGatewayProviderId(provider.id) ? gatewayModelsById : undefined
            )
          : providerConfig?.modelId
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
    [gatewayModelsById, modelById]
  )

  const resolveProviderMeta = useCallback(
    (provider: Provider, providerConfig?: CliProviderConfig) =>
      resolveProviderMetaForTool(selectedCliTool, provider, providerConfig),
    [resolveProviderMetaForTool, selectedCliTool]
  )

  return {
    refreshModels,
    filterProviders,
    filterProvidersForTool: filterCliProviders,
    makeModelFilter,
    resolveProviderMeta,
    resolveProviderMetaForTool,
    gatewayModelsById,
    modelById,
    defaultGatewayModelId,
    isGatewayModelsLoading
  }
}
