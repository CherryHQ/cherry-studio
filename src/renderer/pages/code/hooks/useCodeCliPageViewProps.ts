import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CodeCliId } from '@shared/data/preference/preferenceTypes'
import {
  CLI_OWN_LOGIN_PROVIDER_ID,
  CodeCli,
  GATEWAY_CAPABLE_CLI_TOOLS,
  isApiGatewayProviderId,
  LOGIN_CAPABLE_CLI_TOOLS
} from '@shared/types/codeCli'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { clearCliConfig } from '../cliConfig'
import type { CodeCliPageViewProps } from '../components/CodeCliPageView'
import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import { OWN_LOGIN_PROVIDER } from '../constants/ownLoginProvider'
import type { CodeToolMeta, VersionStatus } from '../types'
import { useApiGatewayProvider } from './useApiGatewayProvider'
import { useBinaryActions } from './useBinaryActions'
import { useCliVersionStatuses } from './useCliVersionStatuses'
import { useConfigMetadata } from './useConfigMetadata'
import { useConfigPanelController } from './useConfigPanelController'
import { useCurrentCliConfigConnection } from './useCurrentCliConfigConnection'
import { useLaunchDialogController } from './useLaunchDialogController'
import { useOpenClawGatewayController } from './useOpenClawGatewayController'
import { useRemoveCliToolDialog } from './useRemoveCliToolDialog'
import { useSortedSupportedProviders } from './useSortedSupportedProviders'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)

export function useCodeCliPageViewProps(): CodeCliPageViewProps {
  const { t } = useTranslation()
  const toMeta = useCallback(
    (tool: CliToolOption): CodeToolMeta => ({
      id: tool.value,
      label: t(tool.label),
      icon: tool.icon
    }),
    [t]
  )
  const {
    configs,
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
    selectTool,
    setTerminal,
    selectFolder,
    selectedTerminal
  } = useCodeCli()

  const { install, upgrade, remove, installingTools, upgradingTools } = useBinaryActions()
  const { providers } = useProviders()
  const apiGatewayBundle = useApiGatewayProvider()
  const { filterProviders, makeModelFilter, resolveProviderMeta, resolveProviderMetaForTool, gatewayModelsById } =
    useConfigMetadata(selectedCliTool, providers)

  // Per-tool enabled-model summary for the sidebar's second line. Falls back to the
  // provider display name when no model applies (own login, Claude detailed models).
  const providerSummaries = useMemo(() => {
    const summaries: Record<string, string> = {}
    for (const tool of CLI_TOOLS) {
      const state = configs[tool.value as CodeCliId]
      const currentId = state?.current
      if (!currentId) continue
      if (currentId === CLI_OWN_LOGIN_PROVIDER_ID) {
        summaries[tool.value] = t('code.own_login.title', { toolName: t(tool.label) })
        continue
      }
      // The gateway is synthetic (absent from the real provider list); resolve its summary
      // from the bundle's provider so the sidebar still shows the selected model.
      const provider = isApiGatewayProviderId(currentId)
        ? apiGatewayBundle?.provider
        : providers.find((p) => p.id === currentId)
      if (!provider) continue
      const meta = resolveProviderMetaForTool(tool.value, provider, state.providers[currentId])
      summaries[tool.value] = meta.modelName || meta.providerName
    }
    return summaries
  }, [configs, providers, apiGatewayBundle, resolveProviderMetaForTool, t])

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
  const { supportedProviders, onReorder: handleReorder } = useSortedSupportedProviders({
    providers,
    currentToolState,
    selectedCliTool,
    filterProviders,
    reorderProviders,
    onReorderError: handleReorderError,
    prependedProviders
  })

  const enabledProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useCurrentCliConfigConnection({
    enabledProvider,
    selectedCliTool,
    currentProviderConfig,
    apiGatewayProvider: apiGatewayBundle
  })

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const isProviderlessTool = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
  const isOwnLoginSelected = currentProviderId === CLI_OWN_LOGIN_PROVIDER_ID
  const canLaunch = isProviderlessTool || isOwnLoginSelected || !!enabledProvider
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW
  const activeMeta = activeTool ? toMeta(activeTool) : null
  const toolName = activeMeta?.label ?? ''
  const statuses = useCliVersionStatuses(CLI_TOOL_IDS)
  // Local busy Sets give instant feedback; snapshot operations cover mutations
  // initiated in another window or before this page mounted.
  const mergedInstallingTools = useMemo(() => {
    const merged = new Set<string>(installingTools)
    for (const tool of CLI_TOOLS) {
      const status = statuses[tool.value]
      if (status?.operation?.status === 'installing') merged.add(tool.value)
    }
    return merged
  }, [installingTools, statuses])
  const versionStatus: VersionStatus = statuses[selectedCliTool] ?? {
    installed: false,
    source: 'none',
    canUpgrade: false
  }
  // Only surface install failures here — the dialog is labeled "install error"
  // and offers a retry-install action. Remove failures are reported by their own
  // toast in useBinaryActions, so gating on the action avoids mislabeling a
  // failed uninstall as an install error.
  const installError =
    versionStatus.operation?.status === 'failed' && versionStatus.operation.action === 'install'
      ? versionStatus.operation.error
      : undefined
  // The synthetic own-login entry is always available, so nudge to "select a provider" only when a
  // real provider exists to select — otherwise own-login is the sole option and no nag is warranted.
  const hasRealSupportedProvider = supportedProviders.some((p) => p.id !== CLI_OWN_LOGIN_PROVIDER_ID)
  const showProviderSelectionHint =
    versionStatus.installed && !isProviderlessTool && hasRealSupportedProvider && !currentProviderId

  const configPanel = useConfigPanelController({
    selectedCliTool,
    toolName,
    isToolInstalled: versionStatus.installed,
    currentProviderId,
    providerConfigs,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider,
    setCurrentCliConfigConnection,
    makeModelFilter,
    apiGatewayProvider: apiGatewayBundle
  })
  const launchDialog = useLaunchDialogController({
    selectedCliTool,
    toolName,
    directory,
    enabledProvider,
    isOwnLoginSelected,
    currentProviderConfig,
    selectedTerminal,
    apiGatewayProvider: apiGatewayBundle,
    gatewayModelsById,
    upsertProviderConfig,
    setCurrentProvider,
    setTerminal,
    selectFolder
  })
  const openClawGateway = useOpenClawGatewayController({
    selectedCliTool,
    enabledProvider,
    currentProviderConfig,
    upsertProviderConfig,
    setCurrentProvider
  })
  const handleRemove = useCallback(
    async (toolId: CodeCli) => {
      const success = await remove(toolId)
      if (success && currentProviderId) {
        try {
          await clearCliConfig({ cliTool: toolId })
        } catch (err) {
          logger.error('Failed to clear CLI config on tool removal:', err as Error)
          toast.error(t('code.clear_config_failed'))
        }
        await setCurrentProvider(null)
        setCurrentCliConfigConnection(null)
      }
    },
    [remove, currentProviderId, setCurrentProvider, setCurrentCliConfigConnection, t]
  )
  const removeDialog = useRemoveCliToolDialog({ toolName, remove: handleRemove })

  return {
    sidebarProps: {
      tools: CLI_TOOLS,
      selectedCliTool,
      onSelectTool: selectTool,
      toMeta,
      statuses,
      installingTools: mergedInstallingTools,
      upgradingTools,
      providerSummaries
    },
    contentProps: activeMeta
      ? {
          selectedCliTool,
          activeMeta,
          versionStatus,
          versionCard: {
            visible: true,
            canLaunch,
            launching: launchDialog.launching || openClawGateway.launching || openClawGateway.starting,
            running: openClawGateway.running,
            stopping: openClawGateway.stopping
          },
          installingTools: mergedInstallingTools,
          upgradingTools,
          installError,
          providerState: {
            providerless: isProviderlessTool,
            showSelectionHint: showProviderSelectionHint
          },
          supportedProviders,
          providerConfigs,
          currentProviderId,
          currentProviderModelName: currentCliConfigConnection ? t('code.cli_config.unknown_provider') : undefined,
          resolveProviderMeta,
          onInstall: () => void install(selectedCliTool),
          onUpgrade: () => void upgrade(selectedCliTool, versionStatus.latest),
          // Uninstall authority is the live application fact: offer removal only
          // when the fixed CLI's exact recipe is applied or broken.
          onRemove:
            versionStatus.applicationStatus === 'applied' || versionStatus.applicationStatus === 'broken'
              ? () => removeDialog.requestRemove(selectedCliTool)
              : undefined,
          onLaunch: () => (isOpenClawTool ? void openClawGateway.onLaunch() : launchDialog.openLaunchDialog()),
          onStop: () => void openClawGateway.onStop(),
          onOpenDashboard: () => void openClawGateway.onOpenDashboard(),
          onConfigure: configPanel.openConfigurePanel,
          onToggleCurrent: configPanel.onToggleCurrent,
          onReorder: handleReorder
        }
      : undefined,
    emptyMessage: t('code.select_tool_to_start'),
    launchDialogProps: launchDialog.launchDialogProps,
    removeDialogProps: removeDialog.removeDialogProps,
    configPanelKey: configPanel.configPanelKey,
    configPanelProps: configPanel.configPanelProps,
    ownLoginConfigPanelProps: configPanel.ownLoginConfigPanelProps
  }
}
