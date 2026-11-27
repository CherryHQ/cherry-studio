import { useTranslation } from 'react-i18next'

import { CURSOR_AUTO_MODEL_ID, cursorPreset, resolveCursorModelId } from '@cherrystudio/agent-runtime-cursor/cli'
import { dshModelAddress } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'
import { usePreference } from '@data/hooks/usePreference'
import { useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
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
import { getModelDisplayCapabilityTags, getModelDisplayTags, type ModelDisplayTag } from '@renderer/utils/model'
import { getProviderDisplayName, getProviderDisplayNameById } from '@renderer/utils/naming'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import { getLocalAgentModelStorage } from '@shared/ai/localAgentModel'
import type { AgentEntity } from '@shared/data/types/agent'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli, DEEPSEEK_HARNESS_GATEWAY_ROUTE } from '@shared/types/codeCli'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

export type LocalAgentModelOption = LocalAgentModelCatalog['models'][number] & {
  group?: string
  providerId?: string
  apiModelId?: string
  source?: 'native' | 'gateway'
  tags?: readonly ModelDisplayTag[]
}

const GATEWAY_MODEL_PREFIX = 'gateway-model:'

export type LocalAgentModelSourceRestrictions = Partial<Record<'native' | 'gateway', string>>

export function useLocalAgentModelSelection(
  config: LocalAgentConfiguration | undefined,
  nativeModels: LocalAgentModelCatalog['models'],
  activeNativeModelId?: string
) {
  const { t } = useTranslation()
  const { updateNativeModel } = useUpdateAgent()
  const gateway = useApiGatewayProvider()
  const storage = getLocalAgentModelStorage(config?.presetId)
  const native = storage?.type === 'cli' ? storage : undefined
  const gatewayAtLaunch = storage?.type === 'agent' && !!storage.gatewayModelEndpoint && !config?.executableOverride
  const isCursor = config?.presetId === cursorPreset.id
  const isDeepSeekHarness = config?.presetId === CodeCli.DEEPSEEK_HARNESS
  const followCliLabel = isCursor
    ? undefined
    : t(native?.nativeSelection === 'agent' ? 'local_agents.follow_native_model_config' : 'local_agents.follow_cli')
  const managedDeepSeekHarness = isDeepSeekHarness && !config?.env.DSH_HOME
  const supportsGateway = !!native || managedDeepSeekHarness || gatewayAtLaunch
  const [cliConfigs] = usePreference('feature.code_cli.configs')
  const dshState = managedDeepSeekHarness ? cliConfigs?.[CodeCli.DEEPSEEK_HARNESS] : undefined
  const dshModelId = dshState?.current ? dshState.providers[dshState.current]?.modelId : undefined
  const dshSessionAddress =
    managedDeepSeekHarness && activeNativeModelId
      ? dshModelAddress(activeNativeModelId, DEEPSEEK_HARNESS_GATEWAY_ROUTE)
      : undefined
  const sourceRestrictions: LocalAgentModelSourceRestrictions | undefined = supportsGateway
    ? dshSessionAddress
      ? { gateway: t('local_agents.session_model.current_only') }
      : undefined
    : {
        native: storage?.type === 'agent' ? undefined : t('local_agents.global_model_unavailable'),
        gateway: t('local_agents.model_sources.gateway_not_integrated')
      }
  const { models, isLoading: modelsLoading } = useModels({ enabled: true }, { fetchEnabled: supportsGateway })
  const { providers, isLoading: providersLoading } = useProviders(undefined, {
    enabled: supportsGateway
  })
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const gatewayProviders = getGatewayProviderIds(providers)
  const gatewayModels =
    gatewayAtLaunch ||
    (gateway && (managedDeepSeekHarness || (native && CLI_TOOL_PROVIDER_MAP[native.tool]([gateway.provider]).length)))
      ? models.filter((model) => isCliGatewayModel(gatewayProviders, model))
      : []
  const gatewayModelId = isDeepSeekHarness
    ? dshSessionAddress
      ? gatewayModels.find(
          (model) =>
            formatGatewayModelId(model.providerId, model.apiModelId ?? parseUniqueModelId(model.id).modelId) ===
            dshSessionAddress
        )?.id
      : !config?.nativeModel && dshState?.current === CLI_API_GATEWAY_PROVIDER_ID
        ? dshModelId
        : undefined
    : config?.sourceModelViaGateway
      ? config.sourceModelId
      : undefined
  const nativeModel = isCursor ? resolveCursorModelId(config?.nativeModel) : config?.nativeModel
  const cursorAuto = isCursor
    ? nativeModels.find((model) => resolveCursorModelId(model.id) === CURSOR_AUTO_MODEL_ID)
    : undefined
  const options: LocalAgentModelOption[] = [
    ...nativeModels
      .filter((model) => !isCursor || resolveCursorModelId(model.id) !== CURSOR_AUTO_MODEL_ID)
      .filter(
        (model) =>
          !gatewayModelId || (model.id !== nativeModel && (!dshSessionAddress || model.id !== activeNativeModelId))
      )
      .map((model) => {
        const tags: ModelDisplayTag[] = model.registryModel ? getModelDisplayCapabilityTags(model.registryModel) : []
        if (/free/i.test(`${model.id} ${model.name}`)) tags.push('free')
        return { ...model, source: 'native' as const, tags }
      }),
    ...gatewayModels.map((model) => {
      const sourceProvider = providerById.get(model.providerId)
      return {
        id: `${GATEWAY_MODEL_PREFIX}${model.id}`,
        name: model.name,
        providerId: model.providerId,
        apiModelId: model.apiModelId,
        group: getProviderDisplayName(sourceProvider) || getProviderDisplayNameById(model.providerId),
        source: 'gateway' as const,
        tags: getModelDisplayTags(model, undefined, sourceProvider)
      }
    })
  ]
  if (isCursor) {
    options.unshift({
      ...cursorAuto,
      id: CURSOR_AUTO_MODEL_ID,
      name: t('local_agents.cursor_auto_model'),
      source: 'native'
    })
  }
  const value = gatewayModelId ? `${GATEWAY_MODEL_PREFIX}${gatewayModelId}` : nativeModel
  if (value && !options.some((model) => model.id === value)) {
    const providerId = isUniqueModelId(gatewayModelId) ? parseUniqueModelId(gatewayModelId).providerId : undefined
    options.unshift({
      id: value,
      name: (gatewayModelId && models.find((model) => model.id === gatewayModelId)?.name) || nativeModel || value,
      providerId,
      group: providerId
        ? getProviderDisplayName(providerById.get(providerId)) || getProviderDisplayNameById(providerId)
        : undefined,
      source: gatewayModelId ? 'gateway' : 'native'
    })
  }
  const select = async (agent: AgentEntity, id?: string) => {
    const model = gatewayModels.find((model) => `${GATEWAY_MODEL_PREFIX}${model.id}` === id)
    if (managedDeepSeekHarness && model) {
      if (dshSessionAddress) return
      await ipcApi.request('deepseek_harness.select_gateway_model', { uniqueModelId: model.id })
      return config?.nativeModel ? updateNativeModel(agent.id) : agent
    }
    if (gatewayAtLaunch && model) {
      return updateNativeModel(agent.id, undefined, { sourceModelId: model.id, sourceModelViaGateway: true })
    }
    if (isCursor && id === CURSOR_AUTO_MODEL_ID) return updateNativeModel(agent.id)
    if (
      storage?.type === 'agent' ||
      (native?.nativeSelection === 'agent' && !agent.configuration?.localRuntime?.sourceModelId && !model)
    ) {
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
    followCliLabel,
    select,
    sourceRestrictions,
    activeGatewayModel: !!dshSessionAddress && !!gatewayModelId,
    gatewayLoading: modelsLoading || providersLoading
  }
}
