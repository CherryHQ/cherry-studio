import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useHermesDashboardController } from '@renderer/hooks/agent/useHermesDashboardController'
import { useLocalAgentVersion } from '@renderer/hooks/agent/useLocalAgentVersion'
import { useApiGatewayProvider } from '@renderer/hooks/useApiGatewayProvider'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { clearCliConfig, resolveCliConfigApplyContext } from '@renderer/services/codeCliConfig'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { CODE_CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import {
  CLI_OWN_LOGIN_PROVIDER_ID,
  CodeCli,
  GATEWAY_CAPABLE_CLI_TOOLS,
  LOGIN_CAPABLE_CLI_TOOLS
} from '@shared/types/codeCli'

import type { CodeCliPageViewProps } from '../components/CodeCliPageView'
import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import { OWN_LOGIN_PROVIDER } from '../constants/ownLoginProvider'
import type { CodeToolMeta, VersionStatus } from '../types'
import { useBinaryActions } from './useBinaryActions'
import { useCliVersionStatuses } from './useCliVersionStatuses'
import { useConfigMetadata } from './useConfigMetadata'
import { useConfigPanelController } from './useConfigPanelController'
import { useCurrentCliConfigConnection } from './useCurrentCliConfigConnection'
import { useDeepSeekHarnessController } from './useDeepSeekHarnessController'
import { useLaunchDialogController } from './useLaunchDialogController'
import { useOpenClawGatewayController } from './useOpenClawGatewayController'
import { useRemoveCliToolDialog } from './useRemoveCliToolDialog'
import { useSortedSupportedProviders } from './useSortedSupportedProviders'

const logger = loggerService.withContext('CodeCliPage')

export function useCodeCliPageViewProps(initialTool: CodeCli): CodeCliPageViewProps {
  const { t } = useTranslation()
  const {
    selectedCliTool,
    currentToolState,
    currentProviderId,
    currentProviderConfig,
    providerConfigs,
    directory,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider,
    reorderProviders,
    setTerminal,
    selectFolder,
    selectedTerminal
  } = useCodeCli(initialTool)

  const [modelSaving, setModelSaving] = useState(false)
  const { install, upgrade, remove, installingTools, upgradingTools } = useBinaryActions()
  const { providers, isLoading: isProvidersLoading } = useProviders()
  const apiGatewayBundle = useApiGatewayProvider()
  const {
    refreshModels,
    filterProviders,
    makeModelFilter,
    resolveProviderMeta,
    gatewayModelsById,
    modelById,
    defaultGatewayModelId,
    isGatewayModelsLoading
  } = useConfigMetadata(selectedCliTool, providers, isProvidersLoading)

  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder CLI providers:', error as Error)
      toast.error(t('code.apply_failed'))
    },
    [t]
  )
  const showOwnLoginCard = LOGIN_CAPABLE_CLI_TOOLS.has(selectedCliTool)
  const showGatewayCard = GATEWAY_CAPABLE_CLI_TOOLS.has(selectedCliTool) && !!apiGatewayBundle
  const prependedProviders = useMemo(
    () =>
      [showGatewayCard ? apiGatewayBundle?.provider : null, showOwnLoginCard ? OWN_LOGIN_PROVIDER : null].filter(
        (p): p is NonNullable<typeof p> => p !== null
      ),
    [showGatewayCard, apiGatewayBundle, showOwnLoginCard]
  )
  const { supportedProviders } = useSortedSupportedProviders({
    providers,
    currentToolState,
    selectedCliTool,
    filterProviders,
    reorderProviders,
    onReorderError: handleReorderError,
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
  const { setConnection: setCurrentCliConfigConnection, reload: reloadCliConfigConnection } =
    useCurrentCliConfigConnection({
      enabledProvider,
      selectedCliTool,
      currentProviderConfig: enabledProviderConfig,
      apiGatewayProvider: apiGatewayBundle
    })

  const { statuses } = useCliVersionStatuses([selectedCliTool])
  const activeTool = CLI_TOOLS.find((tool) => tool.value === selectedCliTool)
  const isProviderlessTool = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
  const isOwnLoginSelected = selectedProvider?.id === CLI_OWN_LOGIN_PROVIDER_ID
  const isDeepSeekHarnessTool = selectedCliTool === CodeCli.DEEPSEEK_HARNESS
  const isHermesDashboardTool = selectedCliTool === CodeCli.HERMES
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW
  const activeMeta: CodeToolMeta | null = activeTool
    ? { id: activeTool.value, label: t(activeTool.label), icon: activeTool.icon }
    : null
  const toolName = activeMeta?.label ?? ''
  // Local busy Sets give instant feedback; snapshot operations cover mutations
  // initiated in another window or before this page mounted.
  const mergedInstallingTools = useMemo(() => {
    const merged = new Set<string>(installingTools)
    const status = statuses[selectedCliTool]
    if (status?.operation?.status === 'installing') merged.add(selectedCliTool)
    return merged
  }, [installingTools, selectedCliTool, statuses])
  const snapshotStatus: VersionStatus = statuses[selectedCliTool] ?? {
    installed: false,
    source: 'none',
    canUpgrade: false
  }
  const systemVersion = useLocalAgentVersion(
    isDeepSeekHarnessTool || isOpenClawTool ? `cli:${CODE_CLI_TOOL_PRESET_MAP[selectedCliTool].executable}` : undefined,
    snapshotStatus.resolvedPath
  )
  const versionStatus: VersionStatus = { ...snapshotStatus, ...systemVersion }
  const canLaunch = isHermesDashboardTool
    ? versionStatus.installed
    : (isProviderlessTool || isOwnLoginSelected || !!enabledProvider) &&
      (!isDeepSeekHarnessTool || !!enabledProviderConfig?.modelId)
  // Only surface install failures here — the dialog is labeled "install error"
  // and offers a retry-install action. Remove failures are reported by their own
  // toast in useBinaryActions, so gating on the action avoids mislabeling a
  // failed uninstall as an install error.
  const installError =
    versionStatus.operation?.status === 'failed' && versionStatus.operation.action === 'install'
      ? versionStatus.operation.error
      : undefined
  const configPanel = useConfigPanelController({
    selectedCliTool,
    toolName,
    currentProviderId,
    providerConfigs,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider,
    setCurrentCliConfigConnection,
    makeModelFilter,
    apiGatewayProvider: apiGatewayBundle,
    gatewayModelsById,
    isGatewayModelsLoading
  })
  const launchDialog = useLaunchDialogController({
    selectedCliTool,
    toolName,
    directory,
    enabledProvider,
    isOwnLoginSelected,
    currentProviderConfig: enabledProviderConfig,
    selectedTerminal,
    apiGatewayProvider: apiGatewayBundle,
    gatewayModelsById,
    modelById,
    isModelsLoading: isGatewayModelsLoading,
    upsertProviderConfig,
    setCurrentProvider,
    setTerminal,
    selectFolder
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
  const hermesDashboard = useHermesDashboardController(selectedCliTool, {
    onConfigMayHaveChanged: reloadCliConfigConnection
  })
  const deepSeekHarnessActionsDisabled =
    isDeepSeekHarnessTool && (deepSeekHarness.running || deepSeekHarness.starting || deepSeekHarness.stopping)
  const hermesDashboardActionsDisabled =
    isHermesDashboardTool && (hermesDashboard.running || hermesDashboard.starting || hermesDashboard.stopping)
  const providerActionsDisabled =
    modelSaving ||
    deepSeekHarnessActionsDisabled ||
    hermesDashboardActionsDisabled ||
    (isOpenClawTool && (openClawGateway.running || openClawGateway.starting || openClawGateway.stopping))
  const handleRemove = useCallback(
    async (toolId: CodeCli) => {
      if (toolId === CodeCli.DEEPSEEK_HARNESS && !(await deepSeekHarness.onStop())) return
      if (toolId === CodeCli.HERMES && !(await hermesDashboard.onStop())) return
      const success = await remove(toolId)
      if (success && currentProviderId) {
        if (toolId !== CodeCli.DEEPSEEK_HARNESS) {
          try {
            await clearCliConfig({ cliTool: toolId })
          } catch (err) {
            logger.error('Failed to clear CLI config on tool removal:', err as Error)
            toast.error(t('code.clear_config_failed'))
          }
        }
        await setCurrentProvider(null)
        setCurrentCliConfigConnection(null)
      }
    },
    [deepSeekHarness, hermesDashboard, remove, currentProviderId, setCurrentProvider, setCurrentCliConfigConnection, t]
  )
  const removeDialog = useRemoveCliToolDialog({ toolName, remove: handleRemove })

  const modelOptions = supportedProviders.flatMap((provider) =>
    [...modelById.values()].filter(makeModelFilter(provider.id)).map((model) => ({
      id: JSON.stringify([provider.id, model.id]),
      name: model.name || model.id,
      group: resolveProviderMeta(provider).providerName,
      source: 'gateway' as const,
      provider,
      model
    }))
  )

  return {
    contentProps: activeMeta
      ? {
          selectedCliTool,
          activeMeta,
          modelList: {
            models: modelOptions,
            value: modelOptions.find(
              (option) =>
                option.provider.id === enabledProvider?.id && option.model.id === enabledProviderConfig?.modelId
            )?.id,
            loaded: !isGatewayModelsLoading,
            loading: isGatewayModelsLoading,
            disabled: providerActionsDisabled,
            loadDisabled: false,
            showFollowCli: false,
            onLoad: async () => {
              await refreshModels()
            },
            onSelect: async (id) => {
              const option = modelOptions.find((entry) => entry.id === id)
              if (!option || providerActionsDisabled) return false
              setModelSaving(true)
              try {
                return await configPanel.selectModel(option.provider, option.model.id)
              } finally {
                setModelSaving(false)
              }
            }
          },
          onConfigureCurrent: enabledProvider ? () => configPanel.openConfigurePanel(enabledProvider) : undefined,
          versionStatus,
          versionCard: {
            visible: true,
            canLaunch,
            launching:
              launchDialog.launching ||
              openClawGateway.launching ||
              openClawGateway.starting ||
              deepSeekHarness.launching ||
              deepSeekHarness.starting ||
              hermesDashboard.launching ||
              hermesDashboard.starting,
            running: openClawGateway.running || deepSeekHarness.running || hermesDashboard.running,
            stopping: openClawGateway.stopping || deepSeekHarness.stopping || hermesDashboard.stopping,
            upgradeDisabled: providerActionsDisabled
          },
          installingTools: mergedInstallingTools,
          upgradingTools,
          installError,
          // A failed update carries its target so Retry repeats the same targeted
          // install; a name-only retry would hit the applied no-op and clear the
          // failure without ever re-attempting the update.
          onInstall: () =>
            void install(
              selectedCliTool,
              versionStatus.operation?.status === 'failed' ? versionStatus.operation.targetVersion : undefined
            ),
          onUpgrade: () => void upgrade(selectedCliTool, versionStatus.latest),
          // Uninstall authority is the live application fact: offer removal only
          // when the fixed CLI's exact recipe is applied or broken.
          onRemove:
            versionStatus.applicationStatus === 'applied' || versionStatus.applicationStatus === 'broken'
              ? () => removeDialog.requestRemove(selectedCliTool)
              : undefined,
          onLaunch: () =>
            isHermesDashboardTool
              ? void hermesDashboard.onLaunch()
              : defaultGatewayProvider && !defaultGatewayConfig
                ? configPanel.onToggleCurrent(defaultGatewayProvider)
                : isOpenClawTool
                  ? void openClawGateway.onLaunch()
                  : isDeepSeekHarnessTool
                    ? void deepSeekHarness.onLaunch()
                    : launchDialog.openLaunchDialog(),
          onStop: () =>
            isDeepSeekHarnessTool
              ? void deepSeekHarness.onStop()
              : isHermesDashboardTool
                ? void hermesDashboard.onStop()
                : void openClawGateway.onStop(),
          onOpenDashboard: () =>
            isDeepSeekHarnessTool
              ? void deepSeekHarness.onOpenWebUi()
              : isHermesDashboardTool
                ? void hermesDashboard.onOpenDashboard()
                : void openClawGateway.onOpenDashboard()
        }
      : undefined,
    emptyMessage: t('code.select_tool_to_start'),
    launchDialogProps: launchDialog.launchDialogProps,
    removeDialogProps: removeDialog.removeDialogProps,
    configPanelKey: configPanel.configPanelKey,
    configPanelProps: providerActionsDisabled ? undefined : configPanel.configPanelProps,
    ownLoginConfigPanelProps: configPanel.ownLoginConfigPanelProps
  }
}
