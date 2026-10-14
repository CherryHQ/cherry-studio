import { useTranslation } from 'react-i18next'

import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import {
  CLI_TOOL_PROVIDER_MAP,
  filterCliProviders,
  isCliChatModel,
  getGatewayProviderIds,
  isCliGatewayModel,
  extractConfigFromCliConfigDraft,
  createCliConfigDraftFiles,
  prepareCliConfigClear,
  stripClaudeDetailedModels,
  prepareCliModelConfig
} from '@renderer/services/codeCliConfig'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { AgentEntity } from '@shared/data/types/agent'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

export interface LocalAgentModelOption {
  id: string
  name: string
  group?: string
  source?: 'native' | 'provider' | 'gateway'
}

export const LOCAL_AGENT_MODEL_SOURCE_LABELS = {
  native: 'local_agents.model_sources.native',
  provider: 'local_agents.model_sources.provider',
  gateway: 'code.api_gateway.title'
} as const

const CHERRY_MODEL_PREFIX = 'cherry-model:'
const GATEWAY_MODEL_PREFIX = 'gateway-model:'

/** One selection applies the native CLI files and the chat Agent together. */
export function useLocalAgentModelSelection(
  config: LocalAgentConfiguration | undefined,
  nativeModels: LocalAgentModelCatalog['models']
) {
  const { t } = useTranslation()
  const { updateNativeModel } = useUpdateAgent()
  const gateway = useApiGatewayProvider()
  const native = LOCAL_AGENT_MODEL_CONFIG[config?.presetId ?? '']
  const { models } = useModels({ enabled: true }, { fetchEnabled: !!native })
  const { providers } = useProviders(undefined, { enabled: !!native })
  const compatibleProviders = native ? filterCliProviders(native.tool, providers) : []
  const providerById = new Map(compatibleProviders.map((provider) => [provider.id, provider]))
  const cherryModels = native
    ? models.filter((model) => providerById.has(model.providerId) && isCliChatModel(native.tool, model))
    : []
  const gatewayProviders = getGatewayProviderIds(providers)
  const allProvidersById = new Map(providers.map((provider) => [provider.id, provider]))
  const gatewayModels =
    native && gateway && CLI_TOOL_PROVIDER_MAP[native.tool]([gateway.provider]).length
      ? models.filter((model) => isCliGatewayModel(gatewayProviders, model))
      : []
  const options: LocalAgentModelOption[] = [
    ...nativeModels
      .filter((model) => !config?.sourceModelId || model.id !== config.nativeModel)
      .map((model) => ({ ...model, source: 'native' as const })),
    ...gatewayModels.map((model) => ({
      id: `${GATEWAY_MODEL_PREFIX}${model.id}`,
      name: model.name,
      group: getProviderDisplayName(allProvidersById.get(model.providerId)),
      source: 'gateway' as const
    })),
    ...cherryModels.map((model) => ({
      id: `${CHERRY_MODEL_PREFIX}${model.id}`,
      name: model.name,
      group: getProviderDisplayName(providerById.get(model.providerId)),
      source: 'provider' as const
    }))
  ]
  const value = config?.sourceModelId
    ? `${config.sourceModelViaGateway ? GATEWAY_MODEL_PREFIX : CHERRY_MODEL_PREFIX}${config.sourceModelId}`
    : config?.nativeModel
  if (value && !options.some((model) => model.id === value)) {
    options.unshift({
      id: value,
      name: config?.nativeModel ?? value,
      source: config?.sourceModelId ? (config.sourceModelViaGateway ? 'gateway' : 'provider') : 'native'
    })
  }
  const select = async (agent: AgentEntity, id?: string) => {
    if (!native) throw new Error(t('local_agents.global_model_unavailable'))
    const { files: expectedFiles } = await ipcApi.request('code_cli.read_config', {
      targets: [...getCliConfigTargets(native.tool)]
    })
    const drafts = createCliConfigDraftFiles(expectedFiles)
    const configBlob = stripClaudeDetailedModels(extractConfigFromCliConfigDraft(native.tool, drafts) ?? {})
    const viaGateway = id?.startsWith(GATEWAY_MODEL_PREFIX) ?? false
    const model = (viaGateway ? gatewayModels : cherryModels).find(
      (model) => `${viaGateway ? GATEWAY_MODEL_PREFIX : CHERRY_MODEL_PREFIX}${model.id}` === id
    )
    if (model) {
      let gatewayContext
      if (viaGateway && gateway) {
        await gateway.ensureRunning()
        gatewayContext = { provider: gateway.provider, apiKey: await gateway.getApiKey() }
      }
      const files = await prepareCliModelConfig({
        cliTool: native.tool,
        modelId: model.id,
        writePrimaryModel: true,
        configBlob,
        files: drafts,
        gateway: gatewayContext
      })
      return updateNativeModel(agent.id, undefined, {
        sourceModelId: model.id,
        sourceModelViaGateway: viaGateway || undefined,
        expectedFiles,
        files: files.map(({ target, content }) => ({ target, content }))
      })
    }
    if (id?.startsWith(CHERRY_MODEL_PREFIX) || viaGateway) throw new Error(t('local_agents.models_unavailable'))
    const files = agent.configuration?.localRuntime?.sourceModelId
      ? await prepareCliConfigClear(native.tool, configBlob)
      : undefined
    return updateNativeModel(agent.id, id, { files: files?.length ? files : undefined, expectedFiles })
  }
  return { models: options, value, select }
}
