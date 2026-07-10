import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName } from '@renderer/hooks/useProvider'
import { getClaudeContextModelId, hasClaudeDetailedModels } from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { isCherryAIProvider, isLoginBasedProvider } from '@shared/utils/provider'
import { useCallback, useMemo } from 'react'

import { CLI_TOOL_PROVIDER_MAP, modelSupportsCliTool } from '../constants/cliTools'

/**
 * Provider/model resolution for the code-CLI page: builds the per-tool enabled
 * provider list, the model filter handed to the edit panel's `ModelSelector`,
 * and a display-name resolver for the provider list.
 */
export function useConfigMetadata(selectedCliTool: CodeCli) {
  const { models: allModels } = useModels({ enabled: true })
  const modelById = useMemo(() => new Map(allModels.map((m) => [m.id, m])), [allModels])

  const filterProviders = useCallback(
    (providers: Provider[]): Provider[] => {
      const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
      // Exclude login-based providers (Claude Code / Codex OAuth, etc.): they carry no API
      // key/baseUrl to inject into the CLI config, and their "own login" is already surfaced by
      // the synthetic own-login card. `isLoginBasedProvider` keeps api-key-capable mixed providers.
      return filterFn
        ? filterFn(providers).filter((p) => p.isEnabled && !isCherryAIProvider(p) && !isLoginBasedProvider(p))
        : []
    },
    [selectedCliTool]
  )

  /** Build a model filter scoped to one provider (for the edit panel's picker). */
  const makeModelFilter = useCallback(
    (providerId: string) =>
      (model: Model): boolean => {
        if (isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) return false
        if (!modelSupportsCliTool(selectedCliTool, model)) return false
        return model.providerId === providerId
      },
    [selectedCliTool]
  )

  const resolveProviderMetaForTool = useCallback(
    (toolId: CodeCli, provider: Provider, providerConfig?: CliProviderConfig) => {
      const config = providerConfig?.config ?? {}
      // Detailed Claude configs carry no top-level modelId; surface the primary
      // (fable-role) detailed model instead of hiding the model entirely.
      const modelId =
        toolId === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config)
          ? getClaudeContextModelId(provider.id, config)
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
    [modelById]
  )

  const resolveProviderMeta = useCallback(
    (provider: Provider, providerConfig?: CliProviderConfig) =>
      resolveProviderMetaForTool(selectedCliTool, provider, providerConfig),
    [resolveProviderMetaForTool, selectedCliTool]
  )

  return { filterProviders, makeModelFilter, resolveProviderMeta, resolveProviderMetaForTool }
}
