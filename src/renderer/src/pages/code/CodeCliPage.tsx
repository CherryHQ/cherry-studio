import { Button, Checkbox, EmptyState, Input, Label, SelectDropdown, Textarea } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { isMac, isWin } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { getAssistantSettings, getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { useAppSelector } from '@renderer/store'
import type { EndpointType, Model, Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils/naming'
import { getRotatedProviderApiKey } from '@renderer/utils/providerAuth'
import { formatProviderApiHost } from '@renderer/utils/providerHost'
import type { TerminalConfig } from '@shared/config/constant'
import { codeCLI, terminalApps } from '@shared/config/constant'
import { CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS, isSiliconAnthropicCompatibleModel } from '@shared/config/providers'
import { Check, Code2, Download, FolderOpen, Search, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CLI_TOOL_PROVIDER_MAP,
  CLI_TOOLS,
  generateToolEnvironment,
  OPENAI_CODEX_SUPPORTED_PROVIDERS,
  parseEnvironmentVariables
} from '.'
import { CodeToolDrawer } from './components/CodeToolDrawer'
import { FieldLabel } from './components/FieldLabel'
import { ToolGrid } from './components/ToolGrid'
import type { CodeToolMeta } from './components/types'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

interface ModelItem {
  id: string
  model: Model
  provider: Provider
}

interface TerminalItem {
  id: string
  name: string
}

const CodeCliPage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [isBunInstalled, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')
  const {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    environmentVariables,
    directories,
    currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    setCurrentDir,
    removeDir,
    selectFolder
  } = useCodeCli()
  const { setTimeoutTimer } = useTimer()

  const defaultAssistant = useAppSelector((state) => state.assistants.defaultAssistant)
  const { maxTokens, reasoning_effort } = useMemo(() => {
    if (!defaultAssistant) {
      return { maxTokens: undefined, reasoning_effort: undefined }
    }
    return getAssistantSettings(defaultAssistant)
  }, [defaultAssistant])

  const [isLaunching, setIsLaunching] = useState(false)
  const [launchSuccess, setLaunchSuccess] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [autoUpdateToLatest, setAutoUpdateToLatest] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<TerminalConfig[]>([])
  const [terminalCustomPaths, setTerminalCustomPaths] = useState<Record<string, string>>({})

  const [searchTerm, setSearchTerm] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const modelPredicate = useCallback(
    (m: Model) => {
      if (isEmbeddingModel(m) || isRerankModel(m) || isTextToImageModel(m)) {
        return false
      }

      if (m.provider === 'cherryai') {
        return false
      }

      if (selectedCliTool === codeCLI.claudeCode) {
        if (m.supported_endpoint_types) {
          return m.supported_endpoint_types.includes('anthropic')
        }
        if (m.provider === 'silicon') {
          return isSiliconAnthropicCompatibleModel(m.id)
        }
        const modelProvider = providers.find((p) => p.id === m.provider)
        if (modelProvider?.type === 'anthropic' || modelProvider?.anthropicApiHost) {
          return true
        }
        return m.id.includes('claude') || CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS.includes(m.provider)
      }

      if (selectedCliTool === codeCLI.geminiCli) {
        if (m.supported_endpoint_types) {
          return m.supported_endpoint_types.includes('gemini')
        }
        return m.id.includes('gemini')
      }

      if (selectedCliTool === codeCLI.openaiCodex) {
        if (m.supported_endpoint_types) {
          return ['openai', 'openai-response'].some((type) =>
            m.supported_endpoint_types?.includes(type as EndpointType)
          )
        }
        const openaiProvider = providers.find((p) => p.id === m.provider)
        if (openaiProvider?.type === 'openai-response') {
          return true
        }
        return m.id.includes('openai') || OPENAI_CODEX_SUPPORTED_PROVIDERS.includes(m.provider)
      }

      if (selectedCliTool === codeCLI.githubCopilotCli) {
        return false
      }

      if (selectedCliTool === codeCLI.qwenCode || selectedCliTool === codeCLI.iFlowCli) {
        if (m.supported_endpoint_types) {
          return ['openai', 'openai-response'].some((type) =>
            m.supported_endpoint_types?.includes(type as EndpointType)
          )
        }
        return true
      }

      if (selectedCliTool === codeCLI.openCode) {
        if (m.supported_endpoint_types) {
          return ['openai', 'openai-response', 'anthropic'].some((type) =>
            m.supported_endpoint_types?.includes(type as EndpointType)
          )
        }
        const provider = providers.find((p) => p.id === m.provider)
        return !!['openai', 'openai-response', 'anthropic'].includes(provider?.type ?? '')
      }

      return true
    },
    [selectedCliTool, providers]
  )

  const availableProviders = useMemo(() => {
    const filterFn = CLI_TOOL_PROVIDER_MAP[selectedCliTool]
    return filterFn ? filterFn(providers) : []
  }, [providers, selectedCliTool])

  const modelItems = useMemo<ModelItem[]>(() => {
    const items: ModelItem[] = []
    for (const provider of availableProviders) {
      for (const m of provider.models || []) {
        if (!modelPredicate(m)) continue
        items.push({ id: getModelUniqId(m), model: m, provider })
      }
    }
    return items
  }, [availableProviders, modelPredicate])

  const terminalItems = useMemo<TerminalItem[]>(
    () => availableTerminals.map((terminal) => ({ id: terminal.id, name: terminal.name })),
    [availableTerminals]
  )

  const directoryItems = useMemo(() => directories.map((dir) => ({ id: dir })), [directories])

  const resolveModel = useCallback(
    (modelIdStr: string): Model | null => {
      for (const provider of providers || []) {
        const model = provider.models.find((m) => getModelUniqId(m) === modelIdStr)
        if (model) return model
      }
      logger.warn(`Model not found for ID: ${modelIdStr}`)
      return null
    },
    [providers]
  )

  const handleModelChange = (value: string) => {
    if (!value) {
      setModel(null).catch((err) => logger.error('Failed to clear model:', err as Error))
      return
    }
    setModel(value).catch((err) => logger.error('Failed to set model:', err as Error))
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

  const handleInstallBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      setIsBunInstalled(true)
      window.toast.success(t('settings.mcp.installSuccess'))
    } catch (error) {
      logger.error('Failed to install bun:', error as Error)
      const message = error instanceof Error ? error.message : String(error)
      window.toast.error(`${t('settings.mcp.installError')}: ${message}`)
    } finally {
      setIsInstallingBun(false)
      setTimeoutTimer('handleInstallBun', checkBunInstallation, 1000)
    }
  }

  const validateLaunch = (): { isValid: boolean; message?: string } => {
    if (!canLaunch || !isBunInstalled) {
      return {
        isValid: false,
        message: !isBunInstalled ? t('code.launch.bun_required') : t('code.launch.validation_error')
      }
    }

    if (!selectedModel && selectedCliTool !== codeCLI.githubCopilotCli) {
      return { isValid: false, message: t('code.model_required') }
    }

    return { isValid: true }
  }

  const prepareLaunchEnvironment = async (): Promise<{
    env: Record<string, string>
  } | null> => {
    if (selectedCliTool === codeCLI.githubCopilotCli) {
      const userEnv = parseEnvironmentVariables(environmentVariables)
      return { env: userEnv }
    }

    if (!selectedModel) return null

    const resolvedModel = resolveModel(selectedModel)
    if (!resolvedModel) return null

    const modelProvider = getProviderByModel(resolvedModel)
    const actualProvider = formatProviderApiHost(modelProvider)
    const baseUrl = actualProvider.apiHost
    const apiKey = getRotatedProviderApiKey(actualProvider)

    const { env: toolEnv } = generateToolEnvironment({
      tool: selectedCliTool,
      model: resolvedModel,
      modelProvider,
      apiKey,
      baseUrl,
      context: { maxTokens, reasoningEffort: reasoning_effort }
    })

    const userEnv = parseEnvironmentVariables(environmentVariables)

    return { env: { ...toolEnv, ...userEnv } }
  }

  const executeLaunch = async (env: Record<string, string>) => {
    const resolvedModel = selectedModel ? resolveModel(selectedModel) : null
    if (selectedCliTool !== codeCLI.githubCopilotCli && !resolvedModel) {
      logger.warn('Cannot launch: model could not be resolved')
      window.toast.error(t('code.model_required'))
      return
    }
    const modelId = selectedCliTool === codeCLI.githubCopilotCli ? '' : (resolvedModel?.id ?? '')

    const runOptions = {
      autoUpdateToLatest,
      terminal: selectedTerminal
    }

    try {
      const result = await window.api.codeCli.run(selectedCliTool, modelId, currentDirectory, env, runOptions)
      if (result && result.success) {
        setLaunchSuccess(true)
        setTimeoutTimer('launchSuccess', () => setLaunchSuccess(false), 2500)
        window.toast.success(t('code.launch.success'))
      } else {
        window.toast.error(result?.message || t('code.launch.error'))
      }
    } catch (error) {
      logger.error('codeTools.run failed:', error as Error)
      window.toast.error(t('code.launch.error'))
    }
  }

  const handleSetCustomPath = async (terminalId: string) => {
    try {
      const result = await window.api.file.select({
        properties: ['openFile'],
        filters: [
          { name: 'Executable', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result && result.length > 0) {
        const path = result[0].path
        await window.api.codeCli.setCustomTerminalPath(terminalId, path)
        setTerminalCustomPaths((prev) => ({ ...prev, [terminalId]: path }))
        window.toast.success(t('code.custom_path_set'))
        void loadAvailableTerminals()
      }
    } catch (error) {
      logger.error('Failed to set custom terminal path:', error as Error)
      window.toast.error(t('code.custom_path_error'))
    }
  }

  const handleLaunch = async () => {
    const validation = validateLaunch()

    if (!validation.isValid) {
      window.toast.warning(validation.message || t('code.launch.validation_error'))
      return
    }

    setIsLaunching(true)
    setLaunchSuccess(false)

    try {
      const result = await prepareLaunchEnvironment()
      if (!result) {
        window.toast.error(t('code.model_required'))
        return
      }

      await executeLaunch(result.env)
    } catch (error) {
      logger.error('start code tools failed:', error as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setIsLaunching(false)
    }
  }

  useEffect(() => {
    void checkBunInstallation()
  }, [checkBunInstallation])

  useEffect(() => {
    void loadAvailableTerminals()
  }, [loadAvailableTerminals])

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
    setDrawerOpen(true)
  }

  const filteredTools = useMemo(() => {
    if (!searchTerm) return CLI_TOOLS
    const q = searchTerm.toLowerCase()
    return CLI_TOOLS.filter((ti) => ti.label.toLowerCase().includes(q))
  }, [searchTerm])

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const activeMeta = activeTool ? toMeta(activeTool) : null

  const summaryTerminalLabel = useMemo(
    () => availableTerminals.find((ti) => ti.id === selectedTerminal)?.name ?? selectedTerminal,
    [availableTerminals, selectedTerminal]
  )
  const summaryModelLabel = useMemo(() => {
    if (!selectedModel) return undefined
    const resolved = resolveModel(selectedModel)
    const full = resolved?.name ?? resolved?.id ?? selectedModel
    // Match design: show last segment of model id (e.g. "claude-sonnet-4")
    const parts = full.split('/')
    return parts[parts.length - 1]
  }, [selectedModel, resolveModel])

  const needsWindowsCustomPath =
    isWin &&
    !!selectedTerminal &&
    selectedTerminal !== terminalApps.cmd &&
    selectedTerminal !== terminalApps.powershell &&
    selectedTerminal !== terminalApps.windowsTerminal

  const activeToolValue = drawerOpen ? selectedCliTool : undefined

  return (
    <div className="flex flex-1 flex-col text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('code.title')}</NavbarCenter>
      </Navbar>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!isBunInstalled && (
          <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-3xs border border-warning/30 bg-warning/10 px-3 py-2 text-foreground text-xs">
            <span>{t('code.bun_required_message')}</span>
            <Button size="sm" onClick={handleInstallBun} disabled={isInstallingBun}>
              <Download size={14} />
              {isInstallingBun ? t('code.installing_bun') : t('code.install_bun')}
            </Button>
          </div>
        )}

        <div className="flex h-11 shrink-0 items-center px-4">
          <div className="flex items-center gap-1.5 text-xs">
            <Code2 size={13} className="text-muted-foreground" strokeWidth={1.6} />
            <span className="text-foreground">{t('code.title')}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/40">
              {t('code.count', { count: filteredTools.length })}
            </span>
          </div>
        </div>

        <div className="px-6 py-2">
          <div className="relative mx-auto max-w-md">
            <Search size={13} className="-translate-y-1/2 absolute top-1/2 left-3 z-10 text-muted-foreground/40" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('code.search_placeholder')}
              className="h-auto rounded-3xs border-border/50 bg-muted/20 py-1.5 pr-7 pl-8 text-xs shadow-none placeholder:text-muted-foreground/30 focus-visible:border-primary/30 focus-visible:ring-0"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSearchTerm('')}
                aria-label={t('common.clear')}
                className="-translate-y-1/2 absolute top-1/2 right-1 text-muted-foreground shadow-none hover:text-foreground">
                <X size={12} />
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto max-w-3xl space-y-5">
            {filteredTools.length === 0 ? (
              <EmptyState
                preset={searchTerm ? 'no-result' : 'no-code-tool'}
                title={searchTerm ? t('code.empty.no_match.title') : t('code.empty.no_tool.title')}
                description={searchTerm ? t('code.empty.no_match.description') : t('code.empty.no_tool.description')}
              />
            ) : (
              <ToolGrid
                title={t('code.official_tools')}
                tools={filteredTools}
                activeValue={activeToolValue}
                onSelect={handleSelectTool}
                toMeta={toMeta}
              />
            )}
          </div>
        </div>

        <CodeToolDrawer
          open={drawerOpen}
          tool={activeMeta}
          summary={{ model: summaryModelLabel, terminal: summaryTerminalLabel || undefined }}
          canLaunch={canLaunch && !!isBunInstalled}
          launching={isLaunching}
          launchSuccess={launchSuccess}
          infoTag={t('code.official_tag')}
          onClose={() => setDrawerOpen(false)}
          onLaunch={handleLaunch}>
          {selectedCliTool !== codeCLI.githubCopilotCli && (
            <div>
              <FieldLabel hint={t('code.model_hint')}>{t('code.model')}</FieldLabel>
              <SelectDropdown
                items={modelItems}
                virtualize
                itemHeight={32}
                selectedId={selectedModel}
                onSelect={handleModelChange}
                placeholder={t('code.model_placeholder')}
                renderSelected={(item) => (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ModelAvatar model={item.model} size={12} />
                    <span className="truncate text-foreground">{item.model.name || item.model.id}</span>
                  </div>
                )}
                renderItem={(item, isSelected) => (
                  <div className="flex items-center gap-2">
                    <ModelAvatar model={item.model} size={12} />
                    <span className="flex-1 truncate">{item.model.name || item.model.id}</span>
                    <span className="shrink-0 text-[9px] text-muted-foreground/30">
                      {getFancyProviderName(item.provider)}
                    </span>
                    {isSelected && <Check size={11} className="ml-0.5 shrink-0 text-primary" />}
                  </div>
                )}
              />
            </div>
          )}

          <div>
            <FieldLabel hint={t('code.working_directory_hint')}>{t('code.working_directory')}</FieldLabel>
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
                  renderTriggerLeading={<FolderOpen size={11} className="shrink-0 text-muted-foreground/40" />}
                  renderSelected={(item) => <span className="truncate font-mono text-foreground">{item.id}</span>}
                  renderItem={(item, isSelected) => (
                    <>
                      <FolderOpen
                        size={11}
                        className={isSelected ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground/40'}
                      />
                      <span className="flex-1 truncate font-mono">{item.id}</span>
                      {isSelected && <Check size={11} className="shrink-0 text-primary" />}
                    </>
                  )}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void selectFolder()}
                className="shrink-0 rounded-3xs border-border/40 bg-transparent px-3 py-1.5 text-[10px] text-muted-foreground/60 shadow-none hover:bg-accent/40 hover:text-foreground">
                {t('code.select_folder')}
              </Button>
            </div>
          </div>

          {(isMac || isWin) && terminalItems.length > 0 && (
            <div>
              <FieldLabel hint={t('code.terminal_hint')}>{t('code.terminal')}</FieldLabel>
              <SelectDropdown
                items={terminalItems}
                selectedId={selectedTerminal}
                onSelect={setTerminal}
                placeholder={t('code.terminal_placeholder')}
                renderSelected={(item) => <span className="truncate text-foreground">{item.name}</span>}
                renderItem={(item, isSelected) => (
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{item.name}</span>
                    {isSelected && <Check size={11} className="shrink-0 text-primary" />}
                  </div>
                )}
              />
              {needsWindowsCustomPath && (
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSetCustomPath(selectedTerminal)}
                    className="text-muted-foreground shadow-none hover:text-foreground">
                    <FolderOpen size={10} />
                    {t('code.set_custom_path')}
                  </Button>
                  <span className="truncate text-[10px] text-muted-foreground/50">
                    {terminalCustomPaths[selectedTerminal]
                      ? `${t('code.custom_path')}: ${terminalCustomPaths[selectedTerminal]}`
                      : t('code.custom_path_required')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div>
            <FieldLabel hint={t('code.env_vars_help')}>{t('code.environment_variables')}</FieldLabel>
            <Textarea.Input
              value={environmentVariables}
              onValueChange={setEnvVars}
              rows={2}
              placeholder={'KEY1=value1\nKEY2=value2'}
              className="min-h-0 resize-none rounded-3xs border-border/30 px-2.5 py-1.5 font-mono text-[11px] shadow-none placeholder:text-muted-foreground/20 focus-visible:border-border/50 focus-visible:ring-0 md:text-[11px] [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="code-cli-auto-update"
              size="sm"
              checked={autoUpdateToLatest}
              onCheckedChange={(v) => setAutoUpdateToLatest(v === true)}
              className="size-3.5 rounded-4xs shadow-none"
            />
            <Label
              htmlFor="code-cli-auto-update"
              className="cursor-pointer text-[10px] text-muted-foreground/40 hover:text-foreground/50">
              {t('code.auto_update_to_latest')}
            </Label>
          </div>
        </CodeToolDrawer>
      </div>
    </div>
  )
}

export default CodeCliPage
