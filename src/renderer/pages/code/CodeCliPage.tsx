import { ConfirmDialog } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  clearCliConfig,
  type CliConfigConnection,
  cliConfigConnectionMatchesProvider,
  type CliConfigFileDraft,
  extractConnectionFromCliConfigDraft,
  getClaudeContextModelId,
  hasClaudeDetailedModels,
  injectCliConfig,
  readCliConfigFiles,
  writeCliConfigDraft
} from './cliConfig'
import { CodeCliSidebar } from './components/CodeCliSidebar'
import { ConfigEditPanel } from './components/configEditPanel/ConfigEditPanel'
import { ConfigList } from './components/ConfigList'
import { LaunchDialog } from './components/LaunchDialog'
import { VersionStatusCard } from './components/VersionStatusCard'
import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from './constants/cliTools'
import { useAvailableTerminals } from './hooks/useAvailableTerminals'
import { useBinaryActions } from './hooks/useBinaryActions'
import { useCliVersionStatuses } from './hooks/useCliVersionStatuses'
import { useConfigMetadata } from './hooks/useConfigMetadata'
import type { CodeToolMeta, VersionStatus } from './types/codeCli'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]
type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)

async function readProviderApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
  const result = (await dataApiService.get(`/providers/${providerId}/api-keys`)) as { keys?: ApiKeyEntry[] } | undefined
  return result?.keys ?? []
}

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

function parseConfiguredModelId(modelId: string | undefined): { providerId: string; modelId: string } | null {
  const result = UniqueModelIdSchema.safeParse(modelId)
  if (!result.success) {
    return null
  }
  return parseUniqueModelId(result.data)
}

function resolveCliConfigApplyContext(
  cliTool: CodeCli,
  providerId: string,
  providerConfig: { modelId?: string; config?: Record<string, unknown> } | undefined
): { modelId: UniqueModelId; providerId: string; rawModelId: string; writePrimaryModel: boolean } | null {
  const config = providerConfig?.config ?? {}
  if (cliTool === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config)) {
    const detailedModelId = getClaudeContextModelId(providerId, config)
    const parsedDetailedModelId = parseConfiguredModelId(detailedModelId)
    if (detailedModelId && parsedDetailedModelId) {
      return {
        modelId: detailedModelId,
        providerId: parsedDetailedModelId.providerId,
        rawModelId: parsedDetailedModelId.modelId,
        writePrimaryModel: false
      }
    }
  }

  const parsedModelId = parseConfiguredModelId(providerConfig?.modelId)
  if (!providerConfig?.modelId || !parsedModelId) return null
  return {
    modelId: providerConfig.modelId as UniqueModelId,
    providerId: parsedModelId.providerId,
    rawModelId: parsedModelId.modelId,
    writePrimaryModel: true
  }
}

const CodeCliPage: FC = () => {
  const { t } = useTranslation()
  const [, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')
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
  const navigate = useNavigate()
  const [optimisticProviderOrder, setOptimisticProviderOrder] = useState<{ toolId: CodeCli; ids: string[] } | null>(
    null
  )

  const supportedProviders = useMemo(() => {
    const filtered = filterProviders(providers)
    const entries = new Map(Object.entries(currentToolState.providers))
    const baseSorted = [...filtered]
      .map((provider, index) => ({
        provider,
        index,
        sortIndex: entries.get(provider.id)?.sortIndex
      }))
      .sort((a, b) => {
        if (a.sortIndex !== undefined && b.sortIndex !== undefined && a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex
        }
        if (a.sortIndex !== undefined && b.sortIndex === undefined) return -1
        if (a.sortIndex === undefined && b.sortIndex !== undefined) return 1
        return a.index - b.index
      })
      .map(({ provider }) => provider)

    const orderedIds = optimisticProviderOrder?.toolId === selectedCliTool ? optimisticProviderOrder.ids : null
    if (!orderedIds) return baseSorted

    const optimisticIndex = new Map(orderedIds.map((id, index) => [id, index]))
    const stableIndex = new Map(baseSorted.map((provider, index) => [provider.id, index]))
    return [...baseSorted].sort((a, b) => {
      const ai = optimisticIndex.get(a.id)
      const bi = optimisticIndex.get(b.id)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return (stableIndex.get(a.id) ?? 0) - (stableIndex.get(b.id) ?? 0)
    })
  }, [filterProviders, providers, currentToolState, optimisticProviderOrder, selectedCliTool])

  const handleReorder = useCallback(
    async (nextProviders: Provider[]) => {
      const orderedIds = nextProviders.map((p) => p.id)
      setOptimisticProviderOrder({ toolId: selectedCliTool, ids: orderedIds })
      try {
        await reorderProviders(orderedIds)
      } catch (error) {
        setOptimisticProviderOrder(null)
        logger.error('Failed to reorder CLI providers:', error as Error)
        window.toast.error(t('code.apply_failed'))
        throw error
      }
    },
    [reorderProviders, selectedCliTool, t]
  )

  const enabledProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [openClawGatewayStatus, setOpenClawGatewayStatus] = useState<OpenClawGatewayStatus>('stopped')
  const [stoppingOpenClaw, setStoppingOpenClaw] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<CodeCli | null>(null)
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useState<CliConfigConnection | null>(null)
  const [pendingEnableProviderId, setPendingEnableProviderId] = useState<string | null>(null)
  const openConfigurePanel = useCallback((provider: Provider) => {
    setPendingEnableProviderId(null)
    setEditingProvider(provider)
  }, [])
  const closePanel = useCallback(() => {
    setPendingEnableProviderId(null)
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
      const configPatch = hasConfigValue && values.config !== undefined ? { config: values.config } : {}
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
      const shouldEnableAfterSave = pendingEnableProviderId === editingProvider.id
      if (hasModelValue || hasConfigValue) {
        await upsertProviderConfig(editingProvider.id, {
          modelId,
          ...configPatch
        })
      }
      logger.info('Updated CLI provider config', { toolId: selectedCliTool, providerId: editingProvider.id })
      const resolvedCliConfigContext = resolveCliConfigApplyContext(selectedCliTool, editingProvider.id, {
        modelId,
        config: values.config ?? providerConfigs[editingProvider.id]?.config
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
            configBlob: values.config,
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
      pendingEnableProviderId,
      currentProviderId,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
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
          setPendingEnableProviderId(provider.id)
          setEditingProvider(provider)
          window.toast.error(t('code.launch.validation_error'))
          return
        }
        if (!cliConfigContext) {
          setPendingEnableProviderId(provider.id)
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
    [currentProviderId, selectedCliTool, providerConfigs, upsertProviderConfig, setCurrentProvider, t]
  )

  useEffect(() => {
    let cancelled = false
    if (!enabledProvider) {
      setCurrentCliConfigConnection(null)
      return
    }

    void (async () => {
      const files = await readCliConfigFiles(selectedCliTool)
      const connection = extractConnectionFromCliConfigDraft(selectedCliTool, files)
      if (!connection) {
        if (!cancelled) setCurrentCliConfigConnection(null)
        return
      }
      const apiKeys = await readProviderApiKeys(enabledProvider.id)
      const currentCliConfigContext = resolveCliConfigApplyContext(
        selectedCliTool,
        enabledProvider.id,
        currentProviderConfig ?? undefined
      )
      const expectedModel = currentCliConfigContext?.writePrimaryModel ? currentCliConfigContext.rawModelId : undefined
      if (cancelled) return
      setCurrentCliConfigConnection(
        cliConfigConnectionMatchesProvider(selectedCliTool, connection, enabledProvider, apiKeys, expectedModel)
          ? null
          : connection
      )
    })().catch((error) => {
      logger.error('Failed to read current CLI config connection:', error as Error)
      if (!cancelled) setCurrentCliConfigConnection(null)
    })

    return () => {
      cancelled = true
    }
  }, [enabledProvider, selectedCliTool, currentProviderConfig])

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

  // Refresh the shared MCP bun-presence cache once on mount (MCP relies on it).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bunExists = await window.api.isBinaryExist('bun')
        if (!cancelled) setIsBunInstalled(bunExists)
      } catch (error) {
        logger.error('Failed to check bun installation status:', error as Error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setIsBunInstalled])

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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar: CLI tools list */}
        <CodeCliSidebar
          tools={CLI_TOOLS}
          selectedCliTool={selectedCliTool}
          onSelectTool={selectTool}
          toMeta={toMeta}
          statuses={statuses}
          installingTools={installingTools}
          upgradingTools={upgradingTools}
        />

        {/* Right content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeMeta ? (
            <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto max-w-2xl space-y-5">
                {/* Version status card */}
                {cliPreset && (
                  <VersionStatusCard
                    toolId={selectedCliTool}
                    toolName={activeMeta.label}
                    status={versionStatus}
                    onInstall={() => void install(selectedCliTool)}
                    onUpgrade={() => void upgrade(selectedCliTool)}
                    onRemove={() => setRemoveTarget(selectedCliTool)}
                    onLaunch={() => (isOpenClawTool ? void handleOpenClawLaunch() : setLaunchOpen(true))}
                    onStop={() => void handleOpenClawStop()}
                    canLaunch={canLaunch}
                    launching={launching || (isOpenClawTool && openClawGatewayStatus === 'starting')}
                    running={isOpenClawGatewayRunning}
                    stopping={stoppingOpenClaw}
                    isInstalling={installingTools.has(selectedCliTool)}
                    isUpgrading={upgradingTools.has(selectedCliTool)}
                  />
                )}

                {/* Enabled-provider list */}
                {isProviderlessTool ? (
                  <div className="rounded-lg border border-border/40 bg-accent/10 px-4 py-3 text-muted-foreground text-xs">
                    {t('code.providerless_hint')}
                  </div>
                ) : (
                  <>
                    <ConfigList
                      providers={supportedProviders}
                      providerConfigs={providerConfigs}
                      currentProviderId={currentProviderId}
                      currentProviderModelName={
                        currentCliConfigConnection ? t('code.cli_config.unknown_provider') : undefined
                      }
                      resolveMeta={resolveProviderMeta}
                      onConfigure={openConfigurePanel}
                      onToggleCurrent={handleToggleCurrent}
                      onReorder={handleReorder}
                    />

                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/settings/provider' })}
                      className="flex w-full items-center justify-center gap-1 rounded-xl border border-border/50 border-dashed py-2 text-muted-foreground/55 text-xs transition-colors hover:border-border hover:text-foreground">
                      {t('code.add_provider_hint')}
                      <ExternalLink size={10} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground/50 text-sm">
              {t('code.select_tool_to_start')}
            </div>
          )}
        </div>
      </div>

      <LaunchDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        toolName={activeMeta?.label ?? ''}
        directory={directory}
        terminals={availableTerminals}
        selectedTerminal={selectedTerminal}
        onSelectFolder={() => void handleSelectFolder()}
        onSelectTerminal={(terminal) => void setTerminal(terminal)}
        onLaunch={() => void handleLaunch()}
        launching={launching}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t('settings.plugins.removeConfirmTitle')}
        description={t('settings.plugins.removeConfirmMessage', { name: activeMeta?.label ?? '' })}
        destructive
        onConfirm={async () => {
          if (removeTarget) await remove(removeTarget)
        }}
      />

      {/* Configure dialog */}
      {editingProvider && (
        <ConfigEditPanel
          open={true}
          onClose={closePanel}
          cliTool={selectedCliTool}
          provider={editingProvider}
          providerConfig={providerConfigs[editingProvider.id] ?? null}
          isCurrentProvider={currentProviderId === editingProvider.id}
          modelFilter={makeModelFilter(editingProvider.id)}
          onSubmit={handlePanelSubmit}
        />
      )}
    </div>
  )
}

export default CodeCliPage
