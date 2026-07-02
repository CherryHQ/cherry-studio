import { ConfirmDialog } from '@cherrystudio/ui'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { UniqueModelId } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from './cliTools'
import { CodeCliSidebar } from './components/CodeCliSidebar'
import { ConfigEditPanel } from './components/configEditPanel/ConfigEditPanel'
import { ConfigList } from './components/ConfigList'
import { LaunchDialog } from './components/LaunchDialog'
import { VersionStatusCard } from './components/VersionStatusCard'
import { clearCliConfig, injectCliConfig } from './injectCliConfig'
import type { CodeToolMeta, VersionStatus } from './types'
import { useAvailableTerminals } from './useAvailableTerminals'
import { useBinaryActions } from './useBinaryActions'
import { useCliVersionStatuses } from './useCliVersionStatuses'
import { useConfigMetadata } from './useConfigMetadata'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

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
  const availableTerminals = useAvailableTerminals()
  const { providers } = useProviders()
  const { filterProviders, makeModelFilter, resolveProviderMeta, firstModelByProvider } =
    useConfigMetadata(selectedCliTool)
  const navigate = useNavigate()

  const supportedProviders = useMemo(() => {
    const filtered = filterProviders(providers)
    const entries = new Map(Object.entries(currentToolState.providers))
    // Sort by explicit sortIndex; providers without one appear at the end.
    return [...filtered].sort((a, b) => {
      const ai = entries.get(a.id)?.sortIndex
      const bi = entries.get(b.id)?.sortIndex
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return 0
    })
  }, [filterProviders, providers, currentToolState])

  const handleReorder = useCallback(
    (nextProviders: Provider[]) => {
      void reorderProviders(nextProviders.map((p) => p.id))
    },
    [reorderProviders]
  )

  const enabledProvider = currentProviderId ? supportedProviders.find((p) => p.id === currentProviderId) : undefined

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<CodeCli | null>(null)
  const openConfigurePanel = useCallback((provider: Provider) => setEditingProvider(provider), [])
  const closePanel = useCallback(() => setEditingProvider(null), [])

  const handlePanelSubmit = useCallback(
    async (values: { modelId: UniqueModelId; config?: Record<string, unknown> }) => {
      if (!editingProvider) return
      await upsertProviderConfig(editingProvider.id, {
        modelId: values.modelId,
        ...(values.config ? { config: values.config } : {})
      })
      logger.info('Updated CLI provider config', { toolId: selectedCliTool, providerId: editingProvider.id })
      // Re-apply to the native file when editing the currently active provider.
      if (currentProviderId === editingProvider.id) {
        try {
          await injectCliConfig({
            cliTool: selectedCliTool,
            modelId: values.modelId,
            configBlob: values.config
          })
        } catch (err) {
          logger.error('Failed to inject CLI config on edit:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      }
    },
    [editingProvider, selectedCliTool, currentProviderId, upsertProviderConfig, t]
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
          return
        }
        // Ensure the provider has a config + modelId before injecting. Auto-pick
        // the provider's first enabled model when the user hasn't configured one.
        let cfg = providerConfigs[provider.id]
        let modelId = cfg?.modelId
        if (!modelId) {
          const firstModel = firstModelByProvider.get(provider.id)
          if (!firstModel) {
            window.toast.error(t('code.no_model_for_provider'))
            return
          }
          modelId = firstModel
          await upsertProviderConfig(provider.id, { modelId: firstModel })
          cfg = providerConfigs[provider.id]
        }
        // Inject first; only mark as current on success so the UI never shows a
        // provider as active while its native file failed to write.
        try {
          await injectCliConfig({
            cliTool: selectedCliTool,
            modelId,
            configBlob: cfg?.config
          })
          await setCurrentProvider(provider.id)
        } catch (err) {
          logger.error('Failed to inject CLI config on enable:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      })()
    },
    [
      currentProviderId,
      selectedCliTool,
      firstModelByProvider,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
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

  // The native config file is written at "enable" time, not here — launch only
  // opens a terminal running the CLI in the provider's directory. Provider-less
  // tools (qoder / copilot) launch with a directory only.
  const handleLaunch = useCallback(async () => {
    const isProviderless = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
    if (!directory || (!isProviderless && !enabledProvider)) {
      window.toast.error(t('code.folder_placeholder'))
      return
    }
    const { providerId, modelId: rawModelId } =
      currentProviderConfig && isUniqueModelId(currentProviderConfig.modelId)
        ? parseUniqueModelId(currentProviderConfig.modelId)
        : { providerId: '', modelId: currentProviderConfig?.modelId ?? '' }
    try {
      setLaunching(true)
      const runResult = await ipcApi.request('code_cli.run', {
        cliTool: selectedCliTool,
        model: rawModelId,
        providerId,
        directory,
        env: {},
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
  }, [enabledProvider, currentProviderConfig, directory, selectedCliTool, selectedTerminal, t])

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const isProviderlessTool = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
  const canLaunch = isProviderlessTool || !!enabledProvider
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
                    onLaunch={() => setLaunchOpen(true)}
                    canLaunch={canLaunch}
                    launching={launching}
                    isInstalling={installingTools.has(selectedCliTool)}
                    isUpgrading={upgradingTools.has(selectedCliTool)}
                  />
                )}

                {/* Enabled-provider list */}
                {isProviderlessTool ? (
                  <div className="rounded-lg border border-border/40 bg-accent/10 px-4 py-3 text-xs text-muted-foreground">
                    {t('code.providerless_hint')}
                  </div>
                ) : (
                  <>
                    <ConfigList
                      providers={supportedProviders}
                      providerConfigs={providerConfigs}
                      currentProviderId={currentProviderId}
                      resolveMeta={resolveProviderMeta}
                      onConfigure={openConfigurePanel}
                      onToggleCurrent={handleToggleCurrent}
                      onReorder={handleReorder}
                    />

                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/settings/provider' })}
                      className="flex w-full items-center justify-center gap-1 rounded-xl border border-border/50 border-dashed py-2 text-xs text-muted-foreground/55 transition-colors hover:border-border hover:text-foreground">
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
          defaultModelId={firstModelByProvider.get(editingProvider.id)}
          modelFilter={makeModelFilter(editingProvider.id)}
          onSubmit={handlePanelSubmit}
        />
      )}
    </div>
  )
}

export default CodeCliPage
