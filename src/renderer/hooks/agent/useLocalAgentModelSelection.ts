import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import {
  CLI_TOOL_PROVIDER_MAP,
  gatewayExpectedModel,
  getGatewayModelGroup,
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
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli, DEEPSEEK_HARNESS_GATEWAY_ROUTE } from '@shared/types/codeCli'
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
  nativeModels: LocalAgentModelCatalog['models'],
  activeDshModelId?: string
) {
  const { t } = useTranslation()
  const { updateNativeModel } = useUpdateAgent()
  const gateway = useApiGatewayProvider()
  const native = LOCAL_AGENT_MODEL_CONFIG[config?.presetId ?? '']
  const isDeepSeekHarness = config?.presetId === CodeCli.DEEPSEEK_HARNESS
  const managedDeepSeekHarness = isDeepSeekHarness && !config?.env.DSH_HOME
  const [cliConfigs] = usePreference('feature.code_cli.configs')
  const dshState = managedDeepSeekHarness ? cliConfigs?.[CodeCli.DEEPSEEK_HARNESS] : undefined
  const dshModelId = dshState?.current ? dshState.providers[dshState.current]?.modelId : undefined
  const sourceRestrictions: LocalAgentModelSourceRestrictions | undefined =
    native || managedDeepSeekHarness
      ? undefined
      : {
          native: config?.presetId === 'antigravity-acp' ? undefined : t('local_agents.global_model_unavailable'),
          gateway: t(
            config?.presetId === 'cursor'
              ? 'local_agents.model_sources.cursor_provider_unsupported'
              : 'local_agents.model_sources.gateway_not_integrated'
          )
        }
  const { models, isLoading: modelsLoading } = useModels(
    { enabled: true },
    { fetchEnabled: !!native || managedDeepSeekHarness }
  )
  const { providers, isLoading: providersLoading } = useProviders(undefined, {
    enabled: !!native || managedDeepSeekHarness
  })
  const gatewayProviders = getGatewayProviderIds(providers)
  const gatewayModels =
    gateway && (managedDeepSeekHarness || (native && CLI_TOOL_PROVIDER_MAP[native.tool]([gateway.provider]).length))
      ? models.filter((model) => isCliGatewayModel(gatewayProviders, model))
      : []
  const activeGatewayModel = activeDshModelId
    ? gatewayModels.find(
        (model) =>
          JSON.stringify([DEEPSEEK_HARNESS_GATEWAY_ROUTE, gatewayExpectedModel(model.id, model.apiModelId)]) ===
          activeDshModelId
      )
    : undefined
  const dshGatewayModelId = activeDshModelId
    ? activeGatewayModel?.id
    : dshState?.current === CLI_API_GATEWAY_PROVIDER_ID
      ? dshModelId
      : undefined
  const gatewayModelId = isDeepSeekHarness
    ? dshGatewayModelId
    : config?.sourceModelViaGateway
      ? config.sourceModelId
      : undefined
  const nativeModel = isDeepSeekHarness ? undefined : config?.nativeModel
  const options: LocalAgentModelOption[] = [
    ...(isDeepSeekHarness ? [] : nativeModels)
      .filter((model) => !gatewayModelId || model.id !== nativeModel)
      .map((model) => ({ ...model, source: 'native' as const })),
    ...gatewayModels.map((model) => ({
      id: `${GATEWAY_MODEL_PREFIX}${model.id}`,
      name: model.name,
      group: getGatewayModelGroup(model) ?? t('models.group.ungrouped'),
      source: 'gateway' as const
    }))
  ]
  const value = gatewayModelId ? `${GATEWAY_MODEL_PREFIX}${gatewayModelId}` : nativeModel
  const dshModelName = activeDshModelId
    ? activeGatewayModel?.name
    : dshModelId && (models.find((model) => model.id === dshModelId)?.name || dshModelId)
  if (value && !options.some((model) => model.id === value)) {
    options.unshift({
      id: value,
      name: dshModelName ?? nativeModel ?? value,
      group: gatewayModelId ? t('models.group.ungrouped') : undefined,
      source: gatewayModelId ? 'gateway' : 'native'
    })
  }
  const select = async (agent: AgentEntity, id?: string) => {
    const model = gatewayModels.find((model) => `${GATEWAY_MODEL_PREFIX}${model.id}` === id)
    if (managedDeepSeekHarness) {
      if (!model) throw new Error(t('local_agents.models_unavailable'))
      await ipcApi.request('deepseek_harness.select_gateway_model', { uniqueModelId: model.id })
      return agent
    }
    if (config?.presetId === 'antigravity-acp') {
      if (id && !nativeModels.some((model) => model.id === id)) throw new Error(t('local_agents.models_unavailable'))
      return updateNativeModel(agent.id, id)
    }
    if (!native) throw new Error(t('local_agents.global_model_unavailable'))
    if (id?.startsWith('cherry-model:')) throw new Error(t('local_agents.models_unavailable'))
    if (id && config?.sourceModelId && !gatewayModelId && id === config.nativeModel) return agent
    const { files: expectedFiles } = await ipcApi.request('code_cli.read_config', {
      targets: [...getCliConfigTargets(native.tool)]
    })
    const drafts = createCliConfigDraftFiles(expectedFiles)
    const configBlob = stripClaudeDetailedModels(extractConfigFromCliConfigDraft(native.tool, drafts) ?? {})
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
  return {
    models: options,
    value,
    select,
    sourceRestrictions,
    dshModelName,
    gatewayLoading: modelsLoading || providersLoading
  }
}
