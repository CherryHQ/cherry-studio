import { Button } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { Plus } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS } from './cliTools'
import { CodeCliSidebar } from './components/CodeCliSidebar'
import { ConfigEditPanel } from './components/configEditPanel/ConfigEditPanel'
import { ConfigList } from './components/ConfigList'
import { CurrentConfigPanel } from './components/CurrentConfigPanel'
import { VersionStatusCard } from './components/VersionStatusCard'
import type { CodeToolMeta, VersionStatus } from './types'
import { useAvailableTerminals } from './useAvailableTerminals'
import { useBinaryActions } from './useBinaryActions'
import { useCliVersionStatuses } from './useCliVersionStatuses'
import { useConfigMetadata } from './useConfigMetadata'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

// Stable list of CLI tool ids for the version-status hook.
const CLI_TOOL_IDS = CLI_TOOLS.map((tool) => tool.value)

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

type PanelState = { open: true; target: CliNamedConfig | null } | { open: false }

const CodeCliPage: FC = () => {
  const { t } = useTranslation()
  const [, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')
  const {
    selectedCliTool,
    orderedList,
    currentConfig,
    directories,
    selectedTerminal,
    addConfig,
    updateConfig,
    duplicateConfig,
    deleteConfig,
    setCurrentConfig,
    selectTool,
    setTerminal,
    selectFolder
  } = useCodeCli()

  const { install, upgrade, remove, installingTools, upgradingTools } = useBinaryActions()
  const availableTerminals = useAvailableTerminals()
  const { modelFilter, resolveConfigMeta } = useConfigMetadata(selectedCliTool)

  const [panel, setPanel] = useState<PanelState>({ open: false })

  const openAddPanel = useCallback(() => setPanel({ open: true, target: null }), [])
  const openEditPanel = useCallback((target: CliNamedConfig) => setPanel({ open: true, target }), [])
  const closePanel = useCallback(() => setPanel({ open: false }), [])

  const handlePanelSubmit = useCallback(
    async (values: { name: string; providerId: string; modelId: UniqueModelId; config?: Record<string, unknown> }) => {
      const target = panel.open ? panel.target : null
      if (target) {
        await updateConfig(selectedCliTool, target.id, {
          name: values.name,
          providerId: values.providerId,
          modelId: values.modelId,
          ...(values.config ? { config: values.config } : {})
        })
        logger.info('Updated CLI config', { toolId: selectedCliTool, configId: target.id })
      } else {
        const newId = await addConfig(selectedCliTool, {
          name: values.name,
          providerId: values.providerId,
          modelId: values.modelId,
          ...(values.config ? { config: values.config } : {})
        })
        await setCurrentConfig(selectedCliTool, newId)
      }
    },
    [panel, selectedCliTool, updateConfig, addConfig, setCurrentConfig]
  )

  const handleDuplicate = useCallback(
    async (config: CliNamedConfig) => {
      await duplicateConfig(selectedCliTool, config.id)
      window.toast.success(t('code.duplicate_success'))
    },
    [duplicateConfig, selectedCliTool, t]
  )

  const handleDelete = useCallback(
    async (config: CliNamedConfig) => {
      await deleteConfig(selectedCliTool, config.id)
      window.toast.success(t('common.delete_success'))
    },
    [deleteConfig, selectedCliTool, t]
  )

  const handleToggleCurrent = useCallback(
    (config: CliNamedConfig) => {
      void setCurrentConfig(selectedCliTool, config.id)
    },
    [setCurrentConfig, selectedCliTool]
  )

  const handleSelectFolder = useCallback(async () => {
    if (!currentConfig) return
    try {
      await selectFolder(currentConfig.id)
    } catch (err) {
      logger.error('Failed to select folder:', err as Error)
    }
  }, [currentConfig, selectFolder])

  // Launch the current config: apply its config body to the tool's native
  // config file (claude-code writes ~/.claude/settings.json, cc-switch style),
  // then open a terminal running the CLI in the config's directory.
  const handleLaunch = useCallback(async () => {
    if (!currentConfig || !currentConfig.directory) {
      window.toast.error(t('code.folder_placeholder'))
      return
    }
    const config = currentConfig.config ?? {}
    const { providerId, modelId: rawModelId } = isUniqueModelId(currentConfig.modelId)
      ? parseUniqueModelId(currentConfig.modelId)
      : { providerId: '', modelId: currentConfig.modelId }
    try {
      const runResult = await window.api.codeCli.run(
        selectedCliTool,
        rawModelId,
        providerId,
        currentConfig.directory,
        {},
        { terminal: selectedTerminal ?? undefined },
        config
      )
      if (!runResult.success) {
        window.toast.error(runResult.message)
      }
    } catch (err) {
      logger.error('Failed to launch CLI tool:', err as Error)
      window.toast.error(t('code.launch.error'))
    }
  }, [currentConfig, selectedCliTool, selectedTerminal, t])

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
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
      <Navbar>
        <NavbarCenter className="border-r-0">{t('code.title')}</NavbarCenter>
      </Navbar>

      <div className="flex min-h-0 flex-1 border-border/15 border-t">
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
                {/* Header: tool name + add button */}
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-sm">{activeMeta.label}</span>
                  <Button variant="default" size="sm" onClick={openAddPanel} className="gap-1 text-xs">
                    <Plus size={12} />
                    {t('code.add_config')}
                  </Button>
                </div>

                {/* Version status card */}
                {cliPreset && (
                  <VersionStatusCard
                    toolId={selectedCliTool}
                    toolName={activeMeta.label}
                    toolDescription={t(cliPreset.descriptionKey)}
                    repoUrl={cliPreset.repoUrl}
                    homepage={cliPreset.homepage}
                    status={versionStatus}
                    onInstall={() => void install(selectedCliTool)}
                    onUpgrade={() => void upgrade(selectedCliTool)}
                    onRemove={() => void remove(selectedCliTool)}
                    isInstalling={installingTools.has(selectedCliTool)}
                    isUpgrading={upgradingTools.has(selectedCliTool)}
                  />
                )}

                {/* Named configs list */}
                <ConfigList
                  configs={orderedList}
                  currentConfigId={currentConfig?.id ?? null}
                  resolveMeta={resolveConfigMeta}
                  onEdit={openEditPanel}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                  onToggleCurrent={handleToggleCurrent}
                />

                {/* Current config: working directory + terminal */}
                {currentConfig && (
                  <CurrentConfigPanel
                    config={currentConfig}
                    directories={directories}
                    terminals={availableTerminals}
                    selectedTerminal={selectedTerminal}
                    onSelectFolder={() => void handleSelectFolder()}
                    onSelectDirectory={(dir) =>
                      void updateConfig(selectedCliTool, currentConfig.id, { directory: dir })
                    }
                    onSelectTerminal={(terminal) => void setTerminal(terminal)}
                    onLaunch={() => void handleLaunch()}
                  />
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

      {/* Add / Edit dialog */}
      <ConfigEditPanel
        open={panel.open}
        onClose={closePanel}
        cliTool={selectedCliTool}
        config={panel.open ? panel.target : null}
        modelFilter={modelFilter}
        onSubmit={handlePanelSubmit}
      />
    </div>
  )
}

export default CodeCliPage
