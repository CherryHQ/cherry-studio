import { useTranslation } from 'react-i18next'

import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import {
  CLI_TOOL_PROVIDER_MAP,
  modelSupportsCliTool,
  extractConfigFromCliConfigDraft,
  readCliConfigFiles,
  prepareCliConfigClear,
  stripClaudeDetailedModels,
  prepareCliModelConfig
} from '@renderer/services/codeCliConfig'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { AgentEntity } from '@shared/data/types/agent'
import { getCliConfigTargets } from '@shared/utils/cliConfig'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { isCherryAIProvider, isLoginBasedProvider } from '@shared/utils/provider'

export interface LocalAgentModelOption {
  id: string
  name: string
  group?: string
}

const CHERRY_MODEL_PREFIX = 'cherry-model:'

/** One selection applies the native CLI files and the chat Agent together. */
export function useLocalAgentModelSelection(
  config: LocalAgentConfiguration | undefined,
  nativeModels: LocalAgentModelCatalog['models']
) {
  const { t } = useTranslation()
  const { updateNativeModel } = useUpdateAgent()
  const native = LOCAL_AGENT_MODEL_CONFIG[config?.presetId ?? '']
  const { models } = useModels({ enabled: true }, { fetchEnabled: !!native })
  const { providers } = useProviders(undefined, { enabled: !!native })
  const compatibleProviders = native
    ? CLI_TOOL_PROVIDER_MAP[native.tool](providers).filter(
        (provider) => provider.isEnabled && !isCherryAIProvider(provider) && !isLoginBasedProvider(provider)
      )
    : []
  const providerById = new Map(compatibleProviders.map((provider) => [provider.id, provider]))
  const cherryModels = native
    ? models.filter(
        (model) =>
          providerById.has(model.providerId) &&
          modelSupportsCliTool(native.tool, model) &&
          !isEmbeddingModel(model) &&
          !isRerankModel(model) &&
          !isTextToImageModel(model)
      )
    : []
  const options: LocalAgentModelOption[] = [
    ...nativeModels.filter((model) => !config?.sourceModelId || model.id !== config.nativeModel),
    ...cherryModels.map((model) => ({
      id: `${CHERRY_MODEL_PREFIX}${model.id}`,
      name: model.name,
      group: getProviderDisplayName(providerById.get(model.providerId))
    }))
  ]
  const value = config?.sourceModelId ? `${CHERRY_MODEL_PREFIX}${config.sourceModelId}` : config?.nativeModel
  if (value && !options.some((model) => model.id === value)) {
    options.unshift({ id: value, name: config?.nativeModel ?? value })
  }
  const select = async (agent: AgentEntity, id?: string) => {
    if (!native) throw new Error(t('local_agents.global_model_unavailable'))
    const { files: expectedFiles } = await ipcApi.request('code_cli.read_config', {
      targets: [...getCliConfigTargets(native.tool)]
    })
    const configBlob = stripClaudeDetailedModels(
      extractConfigFromCliConfigDraft(native.tool, await readCliConfigFiles(native.tool)) ?? {}
    )
    const model = cherryModels.find((model) => `${CHERRY_MODEL_PREFIX}${model.id}` === id)
    if (model) {
      const files = await prepareCliModelConfig({
        cliTool: native.tool,
        modelId: model.id,
        writePrimaryModel: true,
        configBlob
      })
      return updateNativeModel(agent.id, undefined, {
        sourceModelId: model.id,
        expectedFiles,
        files: files.map(({ target, content }) => ({ target, content }))
      })
    }
    if (id?.startsWith(CHERRY_MODEL_PREFIX)) throw new Error(t('local_agents.models_unavailable'))
    const files = agent.configuration?.localRuntime?.sourceModelId
      ? await prepareCliConfigClear(native.tool, configBlob)
      : undefined
    return updateNativeModel(agent.id, id, { files: files?.length ? files : undefined, expectedFiles })
  }
  return { models: options, value, select }
}
