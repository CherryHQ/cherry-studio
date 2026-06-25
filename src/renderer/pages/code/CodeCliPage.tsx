import { Button, SelectDropdown } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS, isSiliconAnthropicCompatibleModel } from '@renderer/config/codeProviders'
import { isMac, isWin } from '@renderer/config/constant'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { BinaryState } from '@shared/data/preference/preferenceTypes'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { TerminalConfig } from '@shared/types/codeCli'
import { codeCLI, terminalApps } from '@shared/types/codeCli'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@shared/utils/model'
import { isAnthropicProvider, isOpenAICompatibleProvider, isOpenAIProvider } from '@shared/utils/provider'
import { Check, ChevronDown, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOL_PROVIDER_MAP, CLI_TOOLS, isOpenCodeProvider, OPENAI_CODEX_SUPPORTED_PROVIDERS } from '.'
import { CodeCliSidebar } from './components/CodeCliSidebar'
import { ProviderConfigForm } from './components/ProviderConfigForm'
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

        // Check latest version from registry
        const binaryName = CLI_BINARY_NAMES[toolId]
        if (binaryName) {
          const results = await ipcApi.request('binary.search_registry', binaryName)
          const match = results.find((r) => r.name === binaryName)
          if (match?.tool) {
            // Extract version from tool spec if available
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
  const { models } = useModels()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const [, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')
  const {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    directories,
    currentDirectory,
    setCliTool,
    setModel,
    setTerminal,
    setCurrentDir,
    removeDir,
    selectFolder
  } = useCodeCli()

  const [isInstalling, setIsInstalling] = useState(false)
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<TerminalConfig[]>([])
  const [advancedConfig, setAdvancedConfig] = useState<Record<string, any>>({})

  const rawModelId = useCallback((m: Model) => m.apiModelId ?? parseUniqueModelId(m.id).modelId, [])

  const modelPredicate = useCallback(
    (m: Model) => {
      if (isEmbeddingModel(m) || isRerankModel(m) || isTextToImageModel(m)) {
        return false
      }

      if (m.providerId === CHERRYAI_PROVIDER_ID) {
        return false
      }

      const provider = providerMap.get(m.providerId)
      if (!provider) {
        return false
      }

      const eps = m.endpointTypes ?? []
      const id = rawModelId(m)

      if (selectedCliTool === codeCLI.claudeCode) {
        if (eps.length) {
          return eps.includes('anthropic-messages')
        }
        if (m.providerId === 'silicon') {
          return isSiliconAnthropicCompatibleModel(id)
        }
        if (isAnthropicProvider(provider)) {
          return true
        }
        return id.includes('claude') || CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS.includes(m.providerId)
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
    [selectedCliTool, providerMap, rawModelId]
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

  const selectedModelValue = useMemo(
    () => (isUniqueModelId(selectedModel) ? selectedModel : undefined),
    [selectedModel]
  )

  const selectedModelRecord = useMemo(
    () =>
      selectedModelValue
        ? models.find((model) => model.id === selectedModelValue && codeCliModelFilter(model))
        : undefined,
    [codeCliModelFilter, models, selectedModelValue]
  )

  const selectedModelProvider = selectedModelRecord ? providerMap.get(selectedModelRecord.providerId) : undefined

  const renderModelSelectorTrigger = () => (
    <button
      type="button"
      className="group flex h-9 w-full items-center justify-between rounded-md border border-border-muted bg-transparent px-3 text-sm transition-colors hover:bg-muted/30 data-[state=open]:border-foreground! data-[state=open]:ring-1 data-[state=open]:ring-foreground/10!">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {selectedModelRecord ? (
          <>
            <ModelAvatar model={selectedModelRecord} size={18} />
            <span className="truncate text-foreground">{selectedModelRecord.name || selectedModelRecord.id}</span>
            {selectedModelProvider && (
              <span className="shrink-0 text-muted-foreground text-xs">
                {getProviderDisplayName(selectedModelProvider)}
              </span>
            )}
          </>
        ) : (
          <span className="truncate text-muted-foreground/50">{t('code.model_placeholder')}</span>
        )}
      </div>
      <ChevronDown
        size={12}
        className="ml-2 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </button>
  )

  const terminalItems = useMemo<{ id: string; name: string }[]>(
    () => availableTerminals.map((terminal) => ({ id: terminal.id, name: terminal.name })),
    [availableTerminals]
  )

  const directoryItems = useMemo(() => directories.map((dir) => ({ id: dir })), [directories])

  const handleModelChange = (modelId: UniqueModelId | undefined) => {
    if (!modelId) {
      setModel(null).catch((err) => logger.error('Failed to clear model:', err as Error))
      return
    }
    setModel(modelId).catch((err) => logger.error('Failed to set model:', err as Error))
  }

  const handleRemoveDirectory = (directory: string) => {
    removeDir(directory).catch((err) => logger.error('Failed to remove directory:', err as Error))
  }

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
      logger.info('Available terminals loaded', {
        count: terminals.length,
        names: terminals.map((ti) => ti.name)
      })
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

  const handleSelectTool = async (tool: codeCLI) => {
    if (tool !== selectedCliTool) {
      try {
        await setCliTool(tool)
      } catch (err) {
        logger.error('Failed to set CLI tool:', err as Error)
        window.toast.error(t('common.error'))
        return
      }
    }
  }

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const activeMeta = activeTool ? toMeta(activeTool) : null
  const versionStatus = useCliVersionStatus(selectedCliTool)

  const needsWindowsCustomPath =
    isWin &&
    !!selectedTerminal &&
    selectedTerminal !== terminalApps.cmd &&
    selectedTerminal !== terminalApps.powershell &&
    selectedTerminal !== terminalApps.windowsTerminal

  useEffect(() => {
    void checkBunInstallation()
  }, [checkBunInstallation])

  useEffect(() => {
    void loadAvailableTerminals()
  }, [loadAvailableTerminals])

  // Get the first available provider for display
  const activeProvider = availableProviders.length > 0 ? availableProviders[0] : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('code.title')}</NavbarCenter>
      </Navbar>

      <div className="flex-1 flex min-h-0 border-t border-border/15">
        {/* Left sidebar: CLI tools list */}
        <CodeCliSidebar
          tools={CLI_TOOLS}
          selectedCliTool={selectedCliTool}
          onSelectTool={handleSelectTool}
          toMeta={toMeta}
        />

        {/* Right content */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {activeMeta ? (
            <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
              <div className="max-w-2xl mx-auto space-y-5">
                {/* Version status card */}
                {(() => {
                  const cliPreset = CLI_TOOL_PRESET_MAP[selectedCliTool]
                  return (
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
                  )
                })()}

                {/* Provider info (readonly) */}
                {activeProvider && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-accent/15 px-3 py-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0 bg-success" />
                    <span className="text-xs text-foreground font-medium flex-shrink-0">
                      {getProviderDisplayName(activeProvider)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground/60 flex-shrink-0">
                      {isAnthropicProvider(activeProvider) ? 'anthropic' : 'openai'}
                    </span>
                    <span className="text-[11px] text-muted-foreground/45 font-mono truncate">
                      {activeProvider.endpointConfigs?.[activeProvider.defaultChatEndpoint ?? 'openai-chat-completions']
                        ?.baseUrl ?? ''}
                    </span>
                  </div>
                )}

                {/* Model selector */}
                <div>
                  <div className="text-xs text-foreground/70 mb-1.5">{t('code.model')}</div>
                  <ModelSelector
                    multiple={false}
                    selectionType="id"
                    value={selectedModelValue}
                    onSelect={handleModelChange}
                    filter={codeCliModelFilter}
                    showTagFilter={false}
                    trigger={renderModelSelectorTrigger()}
                  />
                </div>

                {/* Working directory */}
                <div>
                  <div className="text-xs text-foreground/70 mb-1.5">{t('code.working_directory')}</div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <SelectDropdown
                        items={directoryItems}
                        selectedId={currentDirectory || null}
                        onSelect={(id) => void setCurrentDir(id)}
                        onRemove={handleRemoveDirectory}
                        removeLabel={t('common.delete')}
                        emptyText={t('common.none')}
                        placeholder={t('code.folder_placeholder')}
                        triggerClassName="data-[state=open]:border-foreground! data-[state=open]:ring-foreground/10!"
                        renderTriggerLeading={<FolderOpen size={11} className="shrink-0 text-muted-foreground" />}
                        renderSelected={(item) => <span className="truncate font-mono text-foreground">{item.id}</span>}
                        renderItem={(item, isSelected) => (
                          <>
                            <FolderOpen
                              size={11}
                              className={isSelected ? 'shrink-0 text-foreground' : 'shrink-0 text-muted-foreground'}
                            />
                            <span className="flex-1 truncate font-mono">{item.id}</span>
                            {isSelected && <Check size={11} className="shrink-0 text-foreground" />}
                          </>
                        )}
                      />
                    </div>
                    <Button variant="secondary" size="lg" onClick={() => void selectFolder()} className="shrink-0">
                      {t('code.select_folder')}
                    </Button>
                  </div>
                </div>

                {/* Terminal selection (macOS/Windows only) */}
                {(isMac || isWin) && terminalItems.length > 0 && (
                  <div>
                    <div className="text-xs text-foreground/70 mb-1.5">{t('code.terminal')}</div>
                    <SelectDropdown
                      items={terminalItems}
                      selectedId={selectedTerminal}
                      onSelect={setTerminal}
                      placeholder={t('code.terminal_placeholder')}
                      triggerClassName="data-[state=open]:border-foreground! data-[state=open]:ring-foreground/10!"
                      renderSelected={(item) => <span className="truncate text-foreground">{item.name}</span>}
                      renderItem={(item, isSelected) => (
                        <div className="flex items-center gap-2">
                          <span className="flex-1">{item.name}</span>
                          {isSelected && <Check size={11} className="shrink-0 text-foreground" />}
                        </div>
                      )}
                    />
                    {needsWindowsCustomPath && (
                      <div className="mt-2 flex min-w-0 items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            /* TODO: Set custom path */
                          }}
                          className="text-muted-foreground shadow-none hover:text-foreground">
                          <FolderOpen size={10} />
                          {t('code.set_custom_path')}
                        </Button>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                          {t('code.custom_path_required')}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Advanced config */}
                <ProviderConfigForm
                  cliTool={selectedCliTool}
                  config={advancedConfig}
                  onConfigChange={setAdvancedConfig}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/50">
              {t('code.select_tool_to_start')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CodeCliPage
