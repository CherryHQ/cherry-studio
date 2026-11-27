import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getModelDisplayTags } from '@renderer/components/tags/Model'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { resolveCliConfigApplyContext } from '@renderer/services/codeCliConfig'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { getProviderDisplayName, getProviderDisplayNameById } from '@renderer/utils/naming'
import { CodeCli, GATEWAY_CAPABLE_CLI_TOOLS, isApiGatewayProviderId } from '@shared/types/codeCli'

import { useConfigMetadata } from './useConfigMetadata'
import { useConfigPanelController } from './useConfigPanelController'
import { useDeepSeekHarnessController } from './useDeepSeekHarnessController'
import { useOpenClawGatewayController } from './useOpenClawGatewayController'
import { useSortedSupportedProviders } from './useSortedSupportedProviders'

const logger = loggerService.withContext('CodeCliPage')

export function useManagedLocalAgentDetails(selectedCliTool: CodeCli.OPENCLAW | CodeCli.DEEPSEEK_HARNESS) {
  const { t } = useTranslation()
  const {
    currentToolState,
    currentProviderId,
    currentProviderConfig,
    providerConfigs,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider
  } = useCodeCli(selectedCliTool)

  const [modelSaving, setModelSaving] = useState(false)
  const { providers, isLoading: isProvidersLoading } = useProviders()
  const apiGatewayBundle = useApiGatewayProvider()
  const {
    refreshModels,
    filterProviders,
    makeModelFilter,
    gatewayModelsById,
    modelById,
    defaultGatewayModelId,
    isGatewayModelsLoading
  } = useConfigMetadata(selectedCliTool, providers, isProvidersLoading)

  const showGatewayCard = GATEWAY_CAPABLE_CLI_TOOLS.has(selectedCliTool) && !!apiGatewayBundle
  const prependedProviders = useMemo(
    () => (showGatewayCard && apiGatewayBundle ? [apiGatewayBundle.provider] : []),
    [showGatewayCard, apiGatewayBundle]
  )
  const supportedProviders = useSortedSupportedProviders({
    providers,
    currentToolState,
    filterProviders,
    prependedProviders
  })

  const selectedProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined
  const currentProviderIsPending = !!currentProviderId && !selectedProvider && isProvidersLoading
  const defaultGatewayProvider =
    !selectedProvider && !currentProviderIsPending && showGatewayCard ? apiGatewayBundle?.provider : undefined
  const savedGatewayConfig = defaultGatewayProvider ? providerConfigs[defaultGatewayProvider.id] : undefined
  const hasSavedGatewayContext = defaultGatewayProvider
    ? !!resolveCliConfigApplyContext(selectedCliTool, defaultGatewayProvider.id, savedGatewayConfig, gatewayModelsById)
    : false
  const defaultGatewayConfig = useMemo(
    () =>
      hasSavedGatewayContext
        ? savedGatewayConfig
        : defaultGatewayModelId
          ? { ...savedGatewayConfig, modelId: defaultGatewayModelId }
          : null,
    [hasSavedGatewayContext, savedGatewayConfig, defaultGatewayModelId]
  )
  const enabledProvider = selectedProvider ?? defaultGatewayProvider
  const enabledProviderConfig = selectedProvider ? currentProviderConfig : defaultGatewayConfig
  const isDeepSeekHarnessTool = selectedCliTool === CodeCli.DEEPSEEK_HARNESS
  const canLaunch = !!enabledProvider && (!isDeepSeekHarnessTool || !!enabledProviderConfig?.modelId)
  const configPanel = useConfigPanelController({
    selectedCliTool,
    currentProviderId,
    providerConfigs,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider,
    makeModelFilter,
    apiGatewayProvider: apiGatewayBundle,
    gatewayModelsById,
    isGatewayModelsLoading
  })
  const openClawGateway = useOpenClawGatewayController({
    selectedCliTool,
    enabledProvider,
    currentProviderConfig: enabledProviderConfig,
    upsertProviderConfig,
    setCurrentProvider
  })
  const deepSeekHarness = useDeepSeekHarnessController({
    selectedCliTool,
    enabledProvider,
    currentProviderConfig: enabledProviderConfig,
    upsertProviderConfig,
    setCurrentProvider
  })
  const webUi = isDeepSeekHarnessTool ? deepSeekHarness : openClawGateway
  const providerActionsDisabled = modelSaving || webUi.running || webUi.starting || webUi.stopping

  const providerById = new Map(providers.map((p) => [p.id, p]))
  const modelOptions = supportedProviders
    .filter((provider) => !isDeepSeekHarnessTool || isApiGatewayProviderId(provider.id))
    .flatMap((provider) =>
      [...modelById.values()].filter(makeModelFilter(provider.id)).map((model) => {
        const sourceProvider = providerById.get(model.providerId)
        const name = model.name || model.id
        return {
          id: JSON.stringify([provider.id, model.id]),
          name: !isDeepSeekHarnessTool && isApiGatewayProviderId(provider.id) ? `${name} · ${provider.name}` : name,
          providerId: model.providerId,
          apiModelId: model.apiModelId,
          group: getProviderDisplayName(sourceProvider) || getProviderDisplayNameById(model.providerId),
          source: 'gateway' as const,
          tags: getModelDisplayTags(model, undefined, sourceProvider),
          provider,
          model
        }
      })
    )

  return {
    modelList: {
      models: modelOptions,
      value: modelOptions.find((option) =>
        isDeepSeekHarnessTool
          ? option.provider.id === currentProviderId && option.model.id === currentProviderConfig?.modelId
          : option.provider.id === enabledProvider?.id && option.model.id === enabledProviderConfig?.modelId
      )?.id,
      loaded: !isGatewayModelsLoading,
      loading: isGatewayModelsLoading,
      disabled: providerActionsDisabled,
      loadDisabled: false,
      onLoad: async () => {
        await refreshModels()
      },
      onSelect: async (id) => {
        const option = modelOptions.find((entry) => entry.id === id)
        if (!option || providerActionsDisabled) return false
        setModelSaving(true)
        try {
          if (isDeepSeekHarnessTool) {
            await ipcApi.request('deepseek_harness.select_gateway_model', { uniqueModelId: option.model.id })
            return true
          }
          return await configPanel.selectModel(option.provider, option.model.id)
        } catch (error) {
          logger.error('Failed to select managed Agent model', error as Error)
          toast.error(t('code.apply_failed'))
          return false
        } finally {
          setModelSaving(false)
        }
      }
    },
    webUi: {
      canLaunch,
      canStop: isDeepSeekHarnessTool || openClawGateway.canStop,
      running: webUi.running,
      pending: webUi.launching || webUi.starting || webUi.stopping,
      onLaunch: () => {
        if (defaultGatewayProvider && !defaultGatewayConfig) configPanel.onToggleCurrent(defaultGatewayProvider)
        else void webUi.onLaunch()
      },
      onStop: () => void webUi.onStop(),
      onOpen: isDeepSeekHarnessTool ? deepSeekHarness.onOpenWebUi : openClawGateway.onOpenDashboard
    },
    dialogs: {
      configPanelKey: configPanel.configPanelKey,
      configPanelProps: providerActionsDisabled ? undefined : configPanel.configPanelProps
    }
  }
}
