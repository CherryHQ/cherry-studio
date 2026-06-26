import { Button, EmptyState } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { isMac, isWin } from '@renderer/config/constant'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { BinaryState } from '@shared/data/preference/preferenceTypes'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { TerminalConfig } from '@shared/types/codeCli'
import { codeCLI } from '@shared/types/codeCli'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { isAnthropicProvider, isOpenAICompatibleProvider, isOpenAIProvider } from '@shared/utils/provider'
import { Plus } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOL_PROVIDER_MAP, CLI_TOOLS, isOpenCodeProvider, OPENAI_CODEX_SUPPORTED_PROVIDERS } from '.'
import { CodeCliSidebar } from './components/CodeCliSidebar'
import { ConfigCard } from './components/ConfigCard'
import { ConfigEditPanel } from './components/ConfigEditPanel'
import type { CodeToolMeta } from './components/types'
import { type VersionStatus, VersionStatusCard } from './components/VersionStatusCard'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

// CLI tool name mapping for BinaryManager
const CLI_BINARY_NAMES: Record<string, string> = {
  [codeCLI.claudeCode]: 'claude',
  [codeCLI.openaiCodex]: 'codex',
  [codeCLI.openCode]: 'opencode',
  [codeCLI.openclaw]: 'openclaw',
  [codeCLI.hermes]: 'hermes'
}

// Version status hook using BinaryManager
const useCliVersionStatus = (toolId: string): VersionStatus => {
  const [binaryState, setBinaryState] = useState<BinaryState | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | undefined>()

  useEffect(() => {
    const refreshState = async () => {
      try {
        const state = await ipcApi.request('binary.get_state')
        setBinaryState(state)

        const binaryName = CLI_BINARY_NAMES[toolId]
        if (binaryName) {
          const results = await ipcApi.request('binary.search_registry', binaryName)
          const match = results.find((r) => r.name === binaryName)
          if (match?.tool) {
            const versionMatch = match.tool.match(/@([\d.]+)$/)
            if (versionMatch) {
              setLatestVersion(versionMatch[1])
            }
          }
        }
      } catch (error) {
        logger.error('Failed to get binary state', error as Error)
      }
    }
    void refreshState()
  }, [toolId])

  const binaryName = CLI_BINARY_NAMES[toolId]
  const installed = binaryName ? binaryState?.tools[binaryName] : undefined

  return {
    installed: !!installed,
    current: installed?.version,
    latest: latestVersion,
    canUpgrade: !!installed && !!latestVersion && installed.version !== latestVersion
  }
}

const CodeCliPage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
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

  const [isInstalling, setIsInstalling] = useState(false)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<TerminalConfig[]>([])
  // Edit / add panel state
  const [editTarget, setEditTarget] = useState<CliNamedConfig | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const modelPredicate = useCallback(
    (m: Model) => {
      if (isEmbeddingModel(m) || isRerankModel(m) || isTextToImageModel(m)) {
        return false
      }

      const provider = providerMap.get(m.providerId)
      if (!provider) {
        return false
      }

      const eps = m.endpointTypes ?? []
      const id = m.apiModelId ?? parseUniqueModelId(m.id as UniqueModelId).modelId

      if (selectedCliTool === codeCLI.claudeCode) {
        if (eps.length) {
          return eps.includes('anthropic-messages')
        }
        if (isAnthropicProvider(provider)) {
          return true
        }
        return id.includes('claude')
      }

      if (selectedCliTool === codeCLI.openaiCodex) {
        if (eps.length) {
          return eps.includes('openai-chat-completions') || eps.includes('openai-responses')
        }
        if (isOpenAIProvider(provider)) {
          return true
        }
        return id.includes('openai') || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(m.providerId)
      }

      if (selectedCliTool === codeCLI.openCode || selectedCliTool === codeCLI.openclaw) {
        if (eps.length) {
          return (
            eps.includes('openai-chat-completions') ||
            eps.includes('openai-responses') ||
            eps.includes('anthropic-messages')
          )
        }
        return isOpenCodeProvider(provider)
      }

      if (selectedCliTool === codeCLI.hermes) {
        if (eps.length) {
          return eps.includes('openai-chat-completions') || eps.includes('anthropic-messages')
        }
        return isOpenAICompatibleProvider(provider) || isOpenAIProvider(provider) || isAnthropicProvider(provider)
      }

      return true
    },
    [selectedCliTool, providerMap]
  )

  const availableProviders = useMemo(() => {
    const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
    return filterFn ? filterFn(providers) : []
  }, [providers, selectedCliTool])

  const allowedProviderIds = useMemo(
    () => new Set(availableProviders.map((provider) => provider.id)),
    [availableProviders]
  )

  const codeCliModelFilter = useCallback(
    (model: Model) => allowedProviderIds.has(model.providerId) && modelPredicate(model),
    [allowedProviderIds, modelPredicate]
  )

  // Resolve display names for each config (provider/model)
  const resolveConfigMeta = useCallback(
    (config: CliNamedConfig) => {
      if (!isUniqueModelId(config.modelId)) return { providerName: undefined, modelName: undefined }
      const { providerId, modelId: rawId } = parseUniqueModelId(config.modelId)
      const provider = providerMap.get(providerId)
      const model = provider?.models?.find((m) => m.id === rawId)
      return {
        providerName: provider ? getProviderDisplayName(provider) : providerId,
        modelName: model?.name || rawId
      }
    },
    [providerMap]
  )

  const checkBunInstallation = useCallback(async () => {
    try {
      const bunExists = await window.api.isBinaryExist('bun')
      setIsBunInstalled(bunExists)
    } catch (error) {
      logger.error('Failed to check bun installation status:', error as Error)
    }
  }, [setIsBunInstalled])

  const loadAvailableTerminals = useCallback(async () => {
    if (!isMac && !isWin) return
    try {
      const terminals = await window.api.codeCli.getAvailableTerminals()
      setAvailableTerminals(terminals)
    } catch (error) {
      logger.error('Failed to load available terminals:', error as Error)
      setAvailableTerminals([])
    }
  }, [])

  const handleInstall = async () => {
    try {
      setIsInstalling(true)
      const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]
      if (cliPreset) {
        await ipcApi.request('binary.install_tool', {
          name: CLI_BINARY_NAMES[selectedCliTool],
          tool: cliPreset.packageName
        })
        window.toast.success(t('code.install_success'))
      }
    } catch (error) {
      logger.error('Failed to install:', error as Error)
      window.toast.error(t('code.install_error'))
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUpgrade = async () => {
    try {
      setIsUpgrading(true)
      const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]
      if (cliPreset) {
        await ipcApi.request('binary.install_tool', {
          name: CLI_BINARY_NAMES[selectedCliTool],
          tool: cliPreset.packageName
        })
        window.toast.success(t('code.upgrade_success'))
      }
    } catch (error) {
      logger.error('Failed to upgrade:', error as Error)
      window.toast.error(t('code.upgrade_error'))
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleRemove = async () => {
    try {
      await ipcApi.request('binary.remove_tool', CLI_BINARY_NAMES[selectedCliTool])
      window.toast.success(t('common.delete_success'))
    } catch (error) {
      logger.error('Failed to remove:', error as Error)
      window.toast.error(t('common.delete_failed'))
    }
  }

  const handleSelectTool = (tool: codeCLI) => {
    selectTool(tool)
  }

  // ── Config CRUD handlers ──────────────────────────────────────────────
  const handleOpenAdd = useCallback(() => {
    setEditTarget(null)
    setPanelOpen(true)
  }, [])

  const handleOpenEdit = useCallback((config: CliNamedConfig) => {
    setEditTarget(config)
    setPanelOpen(true)
  }, [])

  const handlePanelSubmit = useCallback(
    async (values: {
      name: string
      providerId: string
      modelId: UniqueModelId
      advanced?: Record<string, unknown>
    }) => {
      if (editTarget) {
        await updateConfig(selectedCliTool, editTarget.id, {
          name: values.name,
          providerId: values.providerId,
          modelId: values.modelId,
          ...(values.advanced ? { advanced: values.advanced } : {})
        })
        logger.info('Updated CLI config', { toolId: selectedCliTool, configId: editTarget.id })
      } else {
        const newId = await addConfig(selectedCliTool, {
          name: values.name,
          providerId: values.providerId,
          modelId: values.modelId,
          ...(values.advanced ? { advanced: values.advanced } : {})
        })
        await setCurrentConfig(selectedCliTool, newId)
      }
    },
    [editTarget, selectedCliTool, updateConfig, addConfig, setCurrentConfig]
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

  const handleSelectFolder = useCallback(
    async (configId: string) => {
      try {
        await selectFolder(configId)
      } catch (err) {
        logger.error('Failed to select folder:', err as Error)
      }
    },
    [selectFolder]
  )

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const activeMeta = activeTool ? toMeta(activeTool) : null
  const versionStatus = useCliVersionStatus(selectedCliTool)
  const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]

  useEffect(() => {
    void checkBunInstallation()
  }, [checkBunInstallation])

  useEffect(() => {
    void loadAvailableTerminals()
  }, [loadAvailableTerminals])

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
          onSelectTool={handleSelectTool}
          toMeta={toMeta}
        />

        {/* Right content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeMeta ? (
            <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto max-w-2xl space-y-5">
                {/* Header: tool name + add button */}
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-sm">{activeMeta.label}</span>
                  <Button variant="default" size="sm" onClick={handleOpenAdd} className="gap-1 text-xs">
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
                    onInstall={handleInstall}
                    onUpgrade={handleUpgrade}
                    onRemove={handleRemove}
                    isInstalling={isInstalling}
                    isUpgrading={isUpgrading}
                  />
                )}

                {/* Named configs list */}
                {orderedList.length === 0 ? (
                  <EmptyState
                    preset="no-code-tool"
                    title={t('code.no_configs_title')}
                    description={t('code.no_configs_description')}
                  />
                ) : (
                  <div className="space-y-[1px]">
                    {orderedList.map((config) => {
                      const meta = resolveConfigMeta(config)
                      const isCurrent = currentConfig?.id === config.id
                      return (
                        <ConfigCard
                          key={config.id}
                          config={config}
                          providerName={meta.providerName}
                          modelName={meta.modelName}
                          isCurrent={isCurrent}
                          onEdit={handleOpenEdit}
                          onDuplicate={handleDuplicate}
                          onDelete={handleDelete}
                          onToggleCurrent={handleToggleCurrent}
                        />
                      )
                    })}
                  </div>
                )}

                {/* Current config: working directory + terminal */}
                {currentConfig && (
                  <div className="space-y-3 border-border/15 border-t pt-4">
                    <div className="font-medium text-muted-foreground text-xs">{t('code.current_config_settings')}</div>
                    <div className="space-y-1.5">
                      <label className="text-foreground/70 text-xs">{t('code.working_directory')}</label>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate rounded-md border border-border-muted bg-muted/30 px-3 py-2 font-mono text-foreground text-xs">
                          {currentConfig.directory || t('code.folder_placeholder')}
                        </div>
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={() => void handleSelectFolder(currentConfig.id)}
                          className="shrink-0">
                          {t('code.select_folder')}
                        </Button>
                      </div>
                      {directories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {directories.map((dir) => (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => void updateConfig(selectedCliTool, currentConfig.id, { directory: dir })}
                              className="max-w-[200px] truncate rounded border border-border/40 bg-muted/20 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                              title={dir}>
                              {dir}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {(isMac || isWin) && availableTerminals.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-foreground/70 text-xs">{t('code.terminal')}</label>
                        <select
                          value={selectedTerminal ?? ''}
                          onChange={(e) => void setTerminal(e.target.value)}
                          className="w-full rounded-md border border-border-muted bg-muted/30 px-3 py-2 text-foreground text-sm">
                          {availableTerminals.map((terminal) => (
                            <option key={terminal.id} value={terminal.id}>
                              {terminal.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
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
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        cliTool={selectedCliTool}
        config={editTarget}
        modelFilter={codeCliModelFilter}
        onSubmit={handlePanelSubmit}
      />
    </div>
  )
}

export default CodeCliPage
