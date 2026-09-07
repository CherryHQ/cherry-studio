import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'
import type { CodeCliId } from '@shared/data/preference/preferenceTypes'
import {
  CLI_OWN_LOGIN_PROVIDER_ID,
  CodeCli,
  GATEWAY_CAPABLE_CLI_TOOLS,
  isApiGatewayProviderId,
  LOGIN_CAPABLE_CLI_TOOLS
} from '@shared/types/codeCli'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { clearCliConfig, resolveCliConfigApplyContext } from '../cliConfig'
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
import { useDeepSeekHarnessController } from './useDeepSeekHarnessController'
import { useHermesDashboardController } from './useHermesDashboardController'
import { useLaunchDialogController } from './useLaunchDialogController'
import { useOpenClawGatewayController } from './useOpenClawGatewayController'
import { useRemoveCliToolDialog } from './useRemoveCliToolDialog'
import { useSortedSupportedProviders } from './useSortedSupportedProviders'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)
const codeCliSidebarTarget = (tool: CodeCli) =>
  createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.CODE_CLI, tool)

// A broken managed install reports installed:false (inactive entries, no shim), and hiding it
// would strip the only surface offering the Retry/Remove that repair or undo it.
const isGeminiVisible = (status?: VersionStatus): boolean =>
  status?.installed === true || status?.applicationStatus === 'broken'

export function useCodeCliPageViewProps(
  initialTool?: CodeCli,
  onToolChange?: (tool: CodeCli) => void
): CodeCliPageViewProps {
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
  } = useCodeCli(initialTool, onToolChange)

  const { install, upgrade, remove, installingTools, upgradingTools } = useBinaryActions()
  const { providers, isLoading: isProvidersLoading } = useProviders()
  const apiGatewayBundle = useApiGatewayProvider()
  const {
    filterProviders,
    filterProvidersForTool,
    makeModelFilter,
    resolveProviderMeta,
    resolveProviderMetaForTool,
    gatewayModelsById,
    modelById,
    defaultGatewayModelId,
    isGatewayModelsLoading
  } = useConfigMetadata(selectedCliTool, providers, isProvidersLoading)

  // Per-tool enabled-model summary for the sidebar's second line. Falls back to the
  // provider display name when no model applies (own login, Claude detailed models).
  const providerSummaries = useMemo(() => {
    const summaries: Record<string, string> = {}
    for (const tool of CLI_TOOLS) {
      const state = configs[tool.value as CodeCliId]
      const currentId = state?.current
      if (!currentId) continue
      if (currentId === CLI_OWN_LOGIN_PROVIDER_ID) {
        if (!LOGIN_CAPABLE_CLI_TOOLS.has(tool.value)) continue
        summaries[tool.value] = t('code.own_login.title', { toolName: t(tool.label) })
        continue
      }
      // The gateway is synthetic (absent from the real provider list); resolve its summary
      // from the bundle's provider so the sidebar still shows the selected model.
      const provider = isApiGatewayProviderId(currentId)
        ? GATEWAY_CAPABLE_CLI_TOOLS.has(tool.value)
          ? apiGatewayBundle?.provider
          : undefined
        : providers.find((p) => p.id === currentId)
      if (!provider) continue
      if (!isApiGatewayProviderId(currentId) && filterProvidersForTool(tool.value, [provider]).length === 0) continue
      const meta = resolveProviderMetaForTool(tool.value, provider, state.providers[currentId])
      summaries[tool.value] = meta.modelName || meta.providerName
    }
    return summaries
  }, [configs, providers, apiGatewayBundle, filterProvidersForTool, resolveProviderMetaForTool, t])

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
  const {
    connection: currentCliConfigConnection,
    setConnection: setCurrentCliConfigConnection,
    reload: reloadCliConfigConnection
  } = useCurrentCliConfigConnection({
    enabledProvider,
    selectedCliTool,
    currentProviderConfig: enabledProviderConfig,
    apiGatewayProvider: apiGatewayBundle
  })

  const { statuses, resolved: statusesResolved } = useCliVersionStatuses(CLI_TOOL_IDS)
  const { isPinned: isSidebarShortcutPinned, toggle: toggleSidebarShortcut } = useSidebarShortcuts()
  const isCliSidebarPinned = useCallback(
    (tool: CodeCli) => isSidebarShortcutPinned(codeCliSidebarTarget(tool)),
    [isSidebarShortcutPinned]
  )
  const toggleCliSidebarShortcut = useCallback(
    (tool: CliToolOption) => toggleSidebarShortcut(codeCliSidebarTarget(tool.value), toMeta(tool).label),
    [toMeta, toggleSidebarShortcut]
  )
  const visibleTools = useMemo(
    () =>
      CLI_TOOLS.filter(
        (tool) =>
          tool.value !== CodeCli.GEMINI_CLI ||
          isGeminiVisible(statuses[CodeCli.GEMINI_CLI]) ||
          isCliSidebarPinned(tool.value)
      ),
    [isCliSidebarPinned, statuses]
  )
  const activeTool = useMemo<CliToolOption | undefined>(
    () => visibleTools.find((tool) => tool.value === selectedCliTool),
    [selectedCliTool, visibleTools]
  )
  useEffect(() => {
    // Gate on `resolved`, not on the status being absent: a failed read leaves the map
    // empty forever, which would hide Gemini while never redirecting off it.
    if (selectedCliTool !== CodeCli.GEMINI_CLI || !statusesResolved) return
    if (isGeminiVisible(statuses[CodeCli.GEMINI_CLI]) || isCliSidebarPinned(CodeCli.GEMINI_CLI)) return
    const fallback = visibleTools[0]
    if (fallback) selectTool(fallback.value)
  }, [isCliSidebarPinned, selectedCliTool, selectTool, statuses, statusesResolved, visibleTools])
  const isProviderlessTool = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
  const isOwnLoginSelected = selectedProvider?.id === CLI_OWN_LOGIN_PROVIDER_ID
  const isDeepSeekHarnessTool = selectedCliTool === CodeCli.DEEPSEEK_HARNESS
  const isHermesDashboardTool = selectedCliTool === CodeCli.HERMES
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW
  const activeMeta = activeTool ? toMeta(activeTool) : null
  const toolName = activeMeta?.label ?? ''
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
  // The synthetic own-login entry is always available, so nudge to "select a provider" only when a
  // real provider exists to select — otherwise own-login is the sole option and no nag is warranted.
  const hasRealSupportedProvider = supportedProviders.some((p) => p.id !== CLI_OWN_LOGIN_PROVIDER_ID)
  const showProviderSelectionHint =
    versionStatus.installed &&
    !isProviderlessTool &&
    hasRealSupportedProvider &&
    !selectedProvider &&
    !currentProviderIsPending &&
    !defaultGatewayProvider

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
  const providerActionsDisabled = deepSeekHarnessActionsDisabled || hermesDashboardActionsDisabled
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

  return {
    sidebarProps: {
      tools: visibleTools,
      selectedCliTool,
      onSelectTool: selectTool,
      toMeta,
      statuses,
      installingTools: mergedInstallingTools,
      upgradingTools,
      providerSummaries,
      isSidebarPinned: isCliSidebarPinned,
      onToggleSidebar: toggleCliSidebarShortcut
    },
    contentProps: activeMeta
      ? {
          selectedCliTool,
          activeMeta,
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
          providerState: {
            providerless: isProviderlessTool,
            showSelectionHint: showProviderSelectionHint
          },
          supportedProviders,
          providerConfigs,
          currentProviderId,
          currentProviderModelName: currentCliConfigConnection ? t('code.cli_config.unknown_provider') : undefined,
          providerActionsDisabled,
          resolveProviderMeta,
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
                : void openClawGateway.onOpenDashboard(),
          onConfigure: configPanel.openConfigurePanel,
          onToggleCurrent: configPanel.onToggleCurrent,
          onReorder: handleReorder
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
