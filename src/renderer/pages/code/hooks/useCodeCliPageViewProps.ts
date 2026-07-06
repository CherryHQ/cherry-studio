import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import { CLI_OWN_LOGIN_PROVIDER_ID, CodeCli, LOGIN_CAPABLE_CLI_TOOLS } from '@shared/types/codeCli'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { clearCliConfig } from '../cliConfig'
import type { CodeCliPageViewProps } from '../components/CodeCliPageView'
import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import { OWN_LOGIN_PROVIDER } from '../constants/ownLoginProvider'
import type { CodeToolMeta, VersionStatus } from '../types/codeCli'
import { useBinaryActions } from './useBinaryActions'
import { useBunInstallationCache } from './useBunInstallationCache'
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
  useBunInstallationCache()
  const {
    selectedCliTool,
    currentToolState,
    currentProviderId,
    currentProviderConfig,
    providerConfigs,
    directory,
    upsertProviderConfig,
    setCurrentProvider,
    reorderProviders,
    selectTool,
    setTerminal,
    selectFolder,
    selectedTerminal
  } = useCodeCli()

  const { install, upgrade, remove, installingTools, upgradingTools } = useBinaryActions()
  const { providers } = useProviders()
  const { filterProviders, makeModelFilter, resolveProviderMeta } = useConfigMetadata(selectedCliTool)

  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder CLI providers:', error as Error)
      window.toast.error(t('code.apply_failed'))
    },
    [t]
  )
  const showOwnLoginCard = LOGIN_CAPABLE_CLI_TOOLS.has(selectedCliTool)
  const { supportedProviders, onReorder: handleReorder } = useSortedSupportedProviders({
    providers,
    currentToolState,
    selectedCliTool,
    filterProviders,
    reorderProviders,
    onReorderError: handleReorderError,
    ownLoginProvider: showOwnLoginCard ? OWN_LOGIN_PROVIDER : null
  })

  const enabledProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useCurrentCliConfigConnection({
    enabledProvider,
    selectedCliTool,
    currentProviderConfig
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
  const versionStatus: VersionStatus = statuses[selectedCliTool] ?? { installed: false, canUpgrade: false }
  const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]
  // The synthetic own-login entry is always available, so nudge to "select a provider" only when a
  // real provider exists to select — otherwise own-login is the sole option and no nag is warranted.
  const hasRealSupportedProvider = supportedProviders.some((p) => p.id !== CLI_OWN_LOGIN_PROVIDER_ID)
  const showProviderSelectionHint =
    !!cliPreset && versionStatus.installed && !isProviderlessTool && hasRealSupportedProvider && !currentProviderId

  const configPanel = useConfigPanelController({
    selectedCliTool,
    toolName,
    currentProviderId,
    providerConfigs,
    upsertProviderConfig,
    setCurrentProvider,
    setCurrentCliConfigConnection,
    makeModelFilter
  })
  const launchDialog = useLaunchDialogController({
    selectedCliTool,
    toolName,
    directory,
    enabledProvider,
    isOwnLoginSelected,
    currentProviderConfig,
    selectedTerminal,
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
        }
        await setCurrentProvider(null)
        setCurrentCliConfigConnection(null)
      }
    },
    [remove, currentProviderId, setCurrentProvider, setCurrentCliConfigConnection]
  )
  const removeDialog = useRemoveCliToolDialog({ toolName, remove: handleRemove })

  return {
    sidebarProps: {
      tools: CLI_TOOLS,
      selectedCliTool,
      onSelectTool: selectTool,
      toMeta,
      statuses,
      installingTools,
      upgradingTools
    },
    contentProps: activeMeta
      ? {
          selectedCliTool,
          activeMeta,
          versionStatus,
          versionCard: {
            visible: !!cliPreset,
            canLaunch,
            launching: launchDialog.launching || openClawGateway.launching || openClawGateway.starting,
            running: openClawGateway.running,
            stopping: openClawGateway.stopping
          },
          installingTools,
          upgradingTools,
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
          onUpgrade: () => void upgrade(selectedCliTool),
          onRemove: () => removeDialog.requestRemove(selectedCliTool),
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
