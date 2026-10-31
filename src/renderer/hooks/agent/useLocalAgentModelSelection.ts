import { useTranslation } from 'react-i18next'

import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import {
  CLI_TOOL_PROVIDER_MAP,
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
  source?: 'native' | 'gateway'
}

export const LOCAL_AGENT_MODEL_SOURCE_LABELS = {
  native: 'local_agents.model_sources.native',
  gateway: 'local_agents.model_sources.gateway'
} as const

const GATEWAY_MODEL_PREFIX = 'gateway-model:'

export type LocalAgentModelSourceRestrictions = Partial<Record<'native' | 'gateway', string>>

/** One selection applies the native CLI files and the chat Agent together. */
export function useLocalAgentModelSelection(
  config: LocalAgentConfiguration | undefined,
  nativeModels: LocalAgentModelCatalog['models']
) {
  const { t } = useTranslation()
  const { updateNativeModel } = useUpdateAgent()
  const gateway = useApiGatewayProvider()
  const native = LOCAL_AGENT_MODEL_CONFIG[config?.presetId ?? '']
  const sourceRestrictions: LocalAgentModelSourceRestrictions | undefined = native
    ? undefined
    : {
        native: t('local_agents.global_model_unavailable'),
        gateway: t(
          config?.presetId === 'cursor'
            ? 'local_agents.model_sources.cursor_provider_unsupported'
            : 'local_agents.model_sources.gateway_not_integrated'
        )
      }
  const { models } = useModels({ enabled: true }, { fetchEnabled: !!native })
  const { providers } = useProviders(undefined, { enabled: !!native })
  const gatewayProviders = getGatewayProviderIds(providers)
  const allProvidersById = new Map(providers.map((provider) => [provider.id, provider]))
  const gatewayModels =
    native && gateway && CLI_TOOL_PROVIDER_MAP[native.tool]([gateway.provider]).length
      ? models.filter((model) => isCliGatewayModel(gatewayProviders, model))
      : []
  const viaGateway = !!config?.sourceModelId && config.sourceModelViaGateway === true
  const options: LocalAgentModelOption[] = [
    ...nativeModels
      .filter((model) => !viaGateway || model.id !== config?.nativeModel)
      .map((model) => ({ ...model, source: 'native' as const })),
    ...gatewayModels.map((model) => ({
      id: `${GATEWAY_MODEL_PREFIX}${model.id}`,
      name: model.name,
      group: getProviderDisplayName(allProvidersById.get(model.providerId)),
      source: 'gateway' as const
    }))
  ]
  const value = viaGateway ? `${GATEWAY_MODEL_PREFIX}${config?.sourceModelId}` : config?.nativeModel
  if (value && !options.some((model) => model.id === value)) {
    options.unshift({
      id: value,
      name: config?.nativeModel ?? value,
      source: viaGateway ? 'gateway' : 'native'
    })
  }
  const select = async (agent: AgentEntity, id?: string) => {
    if (!native) throw new Error(t('local_agents.global_model_unavailable'))
    if (id?.startsWith('cherry-model:')) throw new Error(t('local_agents.models_unavailable'))
    if (id && config?.sourceModelId && !viaGateway && id === config.nativeModel) return agent
    const { files: expectedFiles } = await ipcApi.request('code_cli.read_config', {
      targets: [...getCliConfigTargets(native.tool)]
    })
    const drafts = createCliConfigDraftFiles(expectedFiles)
    const configBlob = stripClaudeDetailedModels(extractConfigFromCliConfigDraft(native.tool, drafts) ?? {})
    const model = gatewayModels.find((model) => `${GATEWAY_MODEL_PREFIX}${model.id}` === id)
    if (model && gateway) {
      await gateway.ensureRunning()
      const files = await prepareCliModelConfig({
        cliTool: native.tool,
        modelId: model.id,
        writePrimaryModel: true,
        configBlob,
        files: drafts,
        gateway: { provider: gateway.provider, apiKey: await gateway.getApiKey() }
      })
      return updateNativeModel(agent.id, undefined, {
        sourceModelId: model.id,
        sourceModelViaGateway: true,
        expectedFiles,
        files: files.map(({ target, content }) => ({ target, content }))
      })
    }
    if (id?.startsWith(GATEWAY_MODEL_PREFIX)) throw new Error(t('local_agents.models_unavailable'))
    const files = agent.configuration?.localRuntime?.sourceModelId
      ? await prepareCliConfigClear(native.tool, configBlob)
      : undefined
    return updateNativeModel(agent.id, id, { files: files?.length ? files : undefined, expectedFiles })
  }
  return { models: options, value, select, sourceRestrictions }
}
