import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseConfiguredModelId, resolveCliConfigApplyContext } from '../cliConfig/applyContext'
import { clearCliConfig } from '../cliConfig/clear'
import { writeCliConfigDraft } from '../cliConfig/draft'
import { injectCliConfig } from '../cliConfig/inject'
import { extractConnectionFromCliConfigDraft } from '../cliConfig/parser'
import { sanitizeCliConfigBlob } from '../cliConfig/sanitize'
import type { CliConfigFileDraft } from '../cliConfig/types'
import type { CodeCliPageViewProps } from '../components/CodeCliPageView'
import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import type { CodeToolMeta, VersionStatus } from '../types/codeCli'
import { useAvailableTerminals } from './useAvailableTerminals'
import { useBinaryActions } from './useBinaryActions'
import { useBunInstallationCache } from './useBunInstallationCache'
import { useCliVersionStatuses } from './useCliVersionStatuses'
import { useConfigMetadata } from './useConfigMetadata'
import { useCurrentCliConfigConnection } from './useCurrentCliConfigConnection'
import { useSortedSupportedProviders } from './useSortedSupportedProviders'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]
type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

export function useCodeCliPageViewProps(): CodeCliPageViewProps {
  const { t } = useTranslation()
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
  const { openSmartMiniApp } = useMiniAppPopup()
  const availableTerminals = useAvailableTerminals()
  const { providers } = useProviders()
  const { filterProviders, makeModelFilter, resolveProviderMeta } = useConfigMetadata(selectedCliTool)

  const handleReorderError = useCallback(
    (error: unknown) => {
      logger.error('Failed to reorder CLI providers:', error as Error)
      window.toast.error(t('code.apply_failed'))
    },
    [t]
  )
  const { supportedProviders, onReorder: handleReorder } = useSortedSupportedProviders({
    providers,
    currentToolState,
    selectedCliTool,
    filterProviders,
    reorderProviders,
    onReorderError: handleReorderError
  })

  const enabledProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useCurrentCliConfigConnection({
    enabledProvider,
    selectedCliTool,
    currentProviderConfig
  })

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [openClawGatewayStatus, setOpenClawGatewayStatus] = useState<OpenClawGatewayStatus>('stopped')
  const [stoppingOpenClaw, setStoppingOpenClaw] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<CodeCli | null>(null)
  const pendingEnableProviderIdRef = useRef<string | null>(null)
  const openConfigurePanel = useCallback((provider: Provider) => {
    pendingEnableProviderIdRef.current = null
    setEditingProvider(provider)
  }, [])
  const closePanel = useCallback(() => {
    pendingEnableProviderIdRef.current = null
    setEditingProvider(null)
  }, [])

  const handlePanelSubmit = useCallback(
    async (values: {
      modelId?: UniqueModelId
      cliConfigModelId?: UniqueModelId
      config?: Record<string, unknown>
      cliConfigFiles?: CliConfigFileDraft[]
      cliConfigOnly?: boolean
      writePrimaryModel?: boolean
    }) => {
      if (!editingProvider) return
      const hasModelValue = 'modelId' in values
      const modelId = values.modelId ?? (hasModelValue ? '' : (providerConfigs[editingProvider.id]?.modelId ?? ''))
      const hasConfigValue = 'config' in values
      const sanitizedConfig = hasConfigValue ? sanitizeCliConfigBlob(selectedCliTool, values.config ?? {}) : undefined
      const configPatch = hasConfigValue ? { config: sanitizedConfig ?? {} } : {}
      if (values.cliConfigOnly) {
        if (!values.cliConfigFiles?.length) {
          throw new Error('Cannot save CLI config without config files')
        }
        const files = values.cliConfigFiles
        await writeCliConfigDraft({
          cliTool: selectedCliTool,
          files
        })
        if (hasModelValue || hasConfigValue) {
          await upsertProviderConfig(editingProvider.id, {
            modelId,
            ...configPatch
          })
        }
        setCurrentCliConfigConnection(extractConnectionFromCliConfigDraft(selectedCliTool, files))
        logger.info('Updated CLI config file draft', { toolId: selectedCliTool })
        return
      }
      const shouldEnableAfterSave = pendingEnableProviderIdRef.current === editingProvider.id
      if (hasModelValue || hasConfigValue) {
        await upsertProviderConfig(editingProvider.id, {
          modelId,
          ...configPatch
        })
      }
      logger.info('Updated CLI provider config', { toolId: selectedCliTool, providerId: editingProvider.id })
      const resolvedCliConfigContext = resolveCliConfigApplyContext(selectedCliTool, editingProvider.id, {
        modelId,
        config: sanitizedConfig ?? providerConfigs[editingProvider.id]?.config
      })
      const cliConfigModelId = values.cliConfigModelId ?? resolvedCliConfigContext?.modelId
      const writePrimaryModel = values.writePrimaryModel ?? resolvedCliConfigContext?.writePrimaryModel
      if (!cliConfigModelId) return
      // Re-apply to the CLI config file when editing the currently active provider.
      if (currentProviderId === editingProvider.id || shouldEnableAfterSave) {
        try {
          await writeCliConfigDraft({
            cliTool: selectedCliTool,
            modelId: cliConfigModelId,
            configBlob: sanitizedConfig,
            files: values.cliConfigFiles,
            writePrimaryModel
          })
          if (shouldEnableAfterSave) {
            await setCurrentProvider(editingProvider.id)
          }
          setCurrentCliConfigConnection(null)
        } catch (err) {
          logger.error('Failed to inject CLI config on edit:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      }
    },
    [
      editingProvider,
      selectedCliTool,
      currentProviderId,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
      setCurrentCliConfigConnection,
      t
    ]
  )

  const handleToggleCurrent = useCallback(
    (provider: Provider) => {
      const isEnabling = currentProviderId !== provider.id
      void (async () => {
        if (!isEnabling) {
          try {
            await clearCliConfig({ cliTool: selectedCliTool })
          } catch (err) {
            logger.error('Failed to clear CLI config on disable:', err as Error)
            window.toast.error(t('code.apply_failed'))
          }
          await setCurrentProvider(null)
          setCurrentCliConfigConnection(null)
          return
        }
        // Ensure the provider has a model before injecting. If none is saved,
        // open configuration so the user chooses explicitly.
        const cfg = providerConfigs[provider.id]
        const cliConfigContext = resolveCliConfigApplyContext(selectedCliTool, provider.id, cfg)
        if (cfg?.modelId && !parseConfiguredModelId(cfg.modelId) && !cliConfigContext) {
          await upsertProviderConfig(provider.id, { modelId: '' })
          pendingEnableProviderIdRef.current = provider.id
          setEditingProvider(provider)
          window.toast.error(t('code.launch.validation_error'))
          return
        }
        if (!cliConfigContext) {
          pendingEnableProviderIdRef.current = provider.id
          setEditingProvider(provider)
          return
        }
        // Inject first; only mark as current on success so the UI never shows a
        // provider as active while its CLI config file failed to write.
        try {
          await injectCliConfig({
            cliTool: selectedCliTool,
            modelId: cliConfigContext.modelId,
            configBlob: cfg?.config,
            writePrimaryModel: cliConfigContext.writePrimaryModel
          })
          await setCurrentProvider(provider.id)
          setCurrentCliConfigConnection(null)
        } catch (err) {
          logger.error('Failed to inject CLI config on enable:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      })()
    },
    [
      currentProviderId,
      selectedCliTool,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
      setCurrentCliConfigConnection,
      t
    ]
  )

  const handleSelectFolder = useCallback(async () => {
    try {
      await selectFolder()
    } catch (err) {
      logger.error('Failed to select folder:', err as Error)
    }
  }, [selectFolder])

  // The CLI config file is written at "enable" time, not here — launch only
  // opens a terminal running the CLI in the provider's directory. Provider-less
  // tools (qoder / copilot) launch with a directory only.
  const handleLaunch = useCallback(async () => {
    const isProviderless = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
    if (!directory || (!isProviderless && !enabledProvider)) {
      window.toast.error(t('code.folder_placeholder'))
      return
    }
    if (isProviderless) {
      try {
        setLaunching(true)
        const runResult = await ipcApi.request('code_cli.run', {
          cliTool: selectedCliTool,
          model: '',
          providerId: '',
          directory,
          options: { terminal: selectedTerminal ?? undefined }
        })
        if (!runResult.success) {
          window.toast.error(runResult.message)
          return
        }
        setLaunchOpen(false)
      } catch (err) {
        logger.error('Failed to launch CLI tool:', err as Error)
        window.toast.error(t('code.launch.error'))
      } finally {
        setLaunching(false)
      }
      return
    }

    const cliConfigContext = enabledProvider
      ? resolveCliConfigApplyContext(selectedCliTool, enabledProvider.id, currentProviderConfig ?? undefined)
      : null
    if (!cliConfigContext) {
      logger.error('Invalid CLI model id configured for launch', {
        modelId: currentProviderConfig?.modelId,
        toolId: selectedCliTool,
        providerId: enabledProvider?.id
      })
      if (enabledProvider) {
        await upsertProviderConfig(enabledProvider.id, { modelId: '' })
      }
      await setCurrentProvider(null)
      window.toast.error(t('code.launch.validation_error'))
      return
    }
    try {
      setLaunching(true)
      const runResult = await ipcApi.request('code_cli.run', {
        cliTool: selectedCliTool,
        model: cliConfigContext.rawModelId,
        providerId: cliConfigContext.providerId,
        directory,
        options: { terminal: selectedTerminal ?? undefined }
      })
      if (!runResult.success) {
        window.toast.error(runResult.message)
      } else {
        setLaunchOpen(false)
      }
    } catch (err) {
      logger.error('Failed to launch CLI tool:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [
    currentProviderConfig,
    directory,
    enabledProvider,
    upsertProviderConfig,
    selectedCliTool,
    selectedTerminal,
    setLaunching,
    setCurrentProvider,
    t
  ])

  const handleOpenClawLaunch = useCallback(async () => {
    if (!enabledProvider || !currentProviderConfig?.modelId) {
      window.toast.error(t('openclaw.error.select_provider_model'))
      return
    }

    const parsedModelId = parseConfiguredModelId(currentProviderConfig.modelId)
    if (!parsedModelId) {
      logger.error('Invalid OpenClaw model id configured', {
        modelId: currentProviderConfig.modelId,
        toolId: selectedCliTool,
        providerId: enabledProvider.id
      })
      await upsertProviderConfig(enabledProvider.id, { modelId: '' })
      await setCurrentProvider(null)
      window.toast.error(t('openclaw.error.select_provider_model'))
      return
    }
    const { providerId, modelId: rawModelId } = parsedModelId

    try {
      setLaunching(true)
      setOpenClawGatewayStatus('starting')
      const syncResult = await ipcApi.request('openclaw.sync_config', `${providerId}::${rawModelId}`)
      if (!syncResult.success) {
        setOpenClawGatewayStatus('error')
        window.toast.error(syncResult.message || t('code.launch.error'))
        return
      }

      const startResult = await ipcApi.request('openclaw.start_gateway', undefined)
      if (!startResult.success) {
        setOpenClawGatewayStatus('error')
        window.toast.error(startResult.message || t('code.launch.error'))
        return
      }

      const dashboardUrl = await ipcApi.request('openclaw.get_dashboard_url')
      openSmartMiniApp({
        appId: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: dashboardUrl,
        logo: 'openclaw'
      })
      setOpenClawGatewayStatus('running')
    } catch (err) {
      setOpenClawGatewayStatus('error')
      logger.error('Failed to launch OpenClaw dashboard:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [
    currentProviderConfig,
    enabledProvider,
    openSmartMiniApp,
    selectedCliTool,
    setCurrentProvider,
    upsertProviderConfig,
    t
  ])

  const handleOpenClawStop = useCallback(async () => {
    try {
      setStoppingOpenClaw(true)
      const result = await ipcApi.request('openclaw.stop_gateway')
      if (!result.success) {
        window.toast.error(result.message || t('code.launch.error'))
        return
      }
      setOpenClawGatewayStatus('stopped')
    } catch (err) {
      logger.error('Failed to stop OpenClaw gateway:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setStoppingOpenClaw(false)
    }
  }, [t])

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const isProviderlessTool = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
  const canLaunch = isProviderlessTool || !!enabledProvider
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW
  const isOpenClawGatewayRunning = isOpenClawTool && openClawGatewayStatus === 'running'
  const activeMeta = activeTool ? toMeta(activeTool) : null
  const statuses = useCliVersionStatuses(CLI_TOOL_IDS)
  const versionStatus: VersionStatus = statuses[selectedCliTool] ?? { installed: false, canUpgrade: false }
  const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]
  const showProviderSelectionHint =
    !!cliPreset && versionStatus.installed && !isProviderlessTool && supportedProviders.length > 0 && !currentProviderId

  useEffect(() => {
    if (!isOpenClawTool) return

    let cancelled = false
    const refreshStatus = async () => {
      try {
        const status = await ipcApi.request('openclaw.get_status')
        if (!cancelled) {
          setOpenClawGatewayStatus(status.status)
        }
      } catch (error) {
        logger.error('Failed to read OpenClaw gateway status:', error as Error)
      }
    }

    void refreshStatus()
    const interval = window.setInterval(refreshStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isOpenClawTool])

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
            launching: launching || (isOpenClawTool && openClawGatewayStatus === 'starting'),
            running: isOpenClawGatewayRunning,
            stopping: stoppingOpenClaw
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
          onRemove: () => setRemoveTarget(selectedCliTool),
          onLaunch: () => (isOpenClawTool ? void handleOpenClawLaunch() : setLaunchOpen(true)),
          onStop: () => void handleOpenClawStop(),
          onConfigure: openConfigurePanel,
          onToggleCurrent: handleToggleCurrent,
          onReorder: handleReorder
        }
      : undefined,
    emptyMessage: t('code.select_tool_to_start'),
    launchDialogProps: {
      open: launchOpen,
      onClose: () => setLaunchOpen(false),
      toolName: activeMeta?.label ?? '',
      directory,
      terminals: availableTerminals,
      selectedTerminal,
      onSelectFolder: () => void handleSelectFolder(),
      onSelectTerminal: (terminal) => void setTerminal(terminal),
      onLaunch: () => void handleLaunch(),
      launching
    },
    removeDialogProps: {
      open: !!removeTarget,
      onOpenChange: (open) => !open && setRemoveTarget(null),
      title: t('settings.plugins.removeConfirmTitle'),
      description: t('settings.plugins.removeConfirmMessage', { name: activeMeta?.label ?? '' }),
      destructive: true,
      onConfirm: async () => {
        if (removeTarget) await remove(removeTarget)
      }
    },
    configPanelKey: editingProvider ? `${selectedCliTool}:${editingProvider.id}` : undefined,
    configPanelProps: editingProvider
      ? {
          onClose: closePanel,
          cliTool: selectedCliTool,
          provider: editingProvider,
          providerConfig: providerConfigs[editingProvider.id] ?? null,
          isCurrentProvider: currentProviderId === editingProvider.id,
          modelFilter: makeModelFilter(editingProvider.id),
          onSubmit: handlePanelSubmit
        }
      : undefined
  }
}
