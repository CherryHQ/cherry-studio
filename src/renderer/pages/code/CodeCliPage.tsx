import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  SelectDropdown,
  Textarea
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
// Direct `Selector/model` path: the `Selector` barrel's nested `export *` isn't
// resolved by tsgo on main's program (resolves on feat's); transitional, reverts
// to the barrel once main converges with feat.
import { ModelSelector } from '@renderer/components/Selector/model'
import { CLAUDE_OFFICIAL_SUPPORTED_PROVIDERS, isSiliconAnthropicCompatibleModel } from '@renderer/config/codeProviders'
import { isMac, isWin } from '@renderer/config/constant'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCodeCli } from '@renderer/hooks/useCodeCli'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { EFFORT_RATIO } from '@renderer/types'
import { getThinkingBudget } from '@shared/ai/reasoningBudget'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import type { TerminalConfig } from '@shared/types/codeCli'
import { codeCLI, terminalApps } from '@shared/types/codeCli'
import {
  isEmbeddingModel,
  isReasoningModel,
  isRerankModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenClaudeModel,
  isTextToImageModel
} from '@shared/utils/model'
import { isAnthropicProvider, isOpenAIProvider } from '@shared/utils/provider'
import { Check, ChevronDown, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CLI_TOOL_PROVIDER_MAP,
  CLI_TOOLS,
  generateToolEnvironment,
  isOpenCodeProvider,
  OPENAI_CODEX_SUPPORTED_PROVIDERS,
  parseEnvironmentVariables
} from '.'
import { CodeToolGallery } from './components/CodeToolGallery'
import { FieldLabel } from './components/FieldLabel'
import type { CodeToolMeta } from './components/types'

const logger = loggerService.withContext('CodeCliPage')

type CliToolOption = (typeof CLI_TOOLS)[number]
type LaunchStatus = 'idle' | 'launching' | 'success'

const toMeta = (tool: CliToolOption): CodeToolMeta => ({
  id: tool.value,
  label: tool.label,
  icon: tool.icon
})

interface TerminalItem {
  id: string
  name: string
}

const CodeCliPage: FC = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { models } = useModels()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
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

  const { maxTokens, reasoning_effort } = DEFAULT_ASSISTANT_SETTINGS

  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>('idle')
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [autoUpdateToLatest, setAutoUpdateToLatest] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<TerminalConfig[]>([])
  const [terminalCustomPaths, setTerminalCustomPaths] = useState<Record<string, string>>({})

  const [dialogOpen, setDialogOpen] = useState(false)
  const [modelSelectorPortalContainer, setModelSelectorPortalContainer] = useState<HTMLDivElement | null>(null)

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

      if (selectedCliTool === codeCLI.geminiCli) {
        if (eps.length) {
          return eps.includes('google-generate-content')
        }
        return id.includes('gemini')
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

      if (selectedCliTool === codeCLI.githubCopilotCli || selectedCliTool === codeCLI.qoderCli) {
        return false
      }

      if (selectedCliTool === codeCLI.qwenCode) {
        if (eps.length) {
          return eps.includes('openai-chat-completions') || eps.includes('openai-responses')
        }
        return true
      }

      if (selectedCliTool === codeCLI.openCode) {
        if (eps.length) {
          return (
            eps.includes('openai-chat-completions') ||
            eps.includes('openai-responses') ||
            eps.includes('anthropic-messages')
          )
        }
        return isOpenCodeProvider(provider)
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

  const terminalItems = useMemo<TerminalItem[]>(
    () => availableTerminals.map((terminal) => ({ id: terminal.id, name: terminal.name })),
    [availableTerminals]
  )

  const directoryItems = useMemo(() => directories.map((dir) => ({ id: dir })), [directories])

  const resolveModel = useCallback(
    (modelIdStr: string): Model | null => {
      const model = models.find((m) => m.id === modelIdStr)
      if (model) return model
      logger.warn(`Model not found for ID: ${modelIdStr}`)
      return null
    },
    [models]
  )

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

  const handleInstallBun = async () => {
    try {
      setIsInstallingBun(true)
      await ipcApi.request('binary.install_tool', { name: 'bun', tool: 'bun' })
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
    // Qoder runs via its `#!/usr/bin/env node` shebang (Node ≥20), not Bun, so it isn't gated on Bun.
    const needsBun = selectedCliTool !== codeCLI.qoderCli
    if (!canLaunch || (needsBun && !isBunInstalled)) {
      return {
        isValid: false,
        message: needsBun && !isBunInstalled ? t('code.launch.bun_required') : t('code.launch.validation_error')
      }
    }

    if (!selectedModel && selectedCliTool !== codeCLI.githubCopilotCli && selectedCliTool !== codeCLI.qoderCli) {
      return { isValid: false, message: t('code.model_required') }
    }

    return { isValid: true }
  }

  const prepareLaunchEnvironment = async (): Promise<{
    env: Record<string, string>
  } | null> => {
    if (selectedCliTool === codeCLI.githubCopilotCli || selectedCliTool === codeCLI.qoderCli) {
      const userEnv = parseEnvironmentVariables(environmentVariables)
      return { env: userEnv }
    }

    if (!selectedModel) return null

    const resolvedModel = resolveModel(selectedModel)
    if (!resolvedModel) return null

    const modelProvider = providerMap.get(resolvedModel.providerId)
    if (!modelProvider) {
      logger.warn(`Provider not found for model: ${resolvedModel.id}`)
      return null
    }

    const isAnthropic = isAnthropicProvider(modelProvider)
    const defaultEndpoint = modelProvider.defaultChatEndpoint ?? 'openai-chat-completions'
    const baseUrl = modelProvider.endpointConfigs?.[defaultEndpoint]?.baseUrl ?? ''
    const anthropicBaseUrl = modelProvider.endpointConfigs?.['anthropic-messages']?.baseUrl

    let apiKey = ''
    try {
      const { keys } = (await dataApiService.get(`/providers/${modelProvider.id}/api-keys`)) as {
        keys: ApiKeyEntry[]
      }
      apiKey = keys.find((k) => k.isEnabled)?.key ?? keys[0]?.key ?? ''
    } catch (error) {
      logger.error(`Failed to load api keys for provider: ${modelProvider.id}`, error as Error)
    }

    const id = resolvedModel.apiModelId ?? parseUniqueModelId(resolvedModel.id).modelId
    const reasoning = {
      isReasoning: isReasoningModel(resolvedModel),
      supportsReasoningEffort: isSupportedReasoningEffortModel(resolvedModel),
      budgetTokens: isSupportedThinkingTokenClaudeModel(resolvedModel)
        ? getThinkingBudget(maxTokens, reasoning_effort, id, EFFORT_RATIO, { fallbackOnUnknown: true })
        : undefined
    }

    const { env: toolEnv } = generateToolEnvironment({
      tool: selectedCliTool,
      rawModelId: id,
      modelName: resolvedModel.name,
      endpointType: resolvedModel.endpointTypes?.[0],
      providerId: modelProvider.id,
      fancyProviderName: getProviderDisplayName(modelProvider),
      isAnthropic,
      anthropicBaseUrl,
      apiKey,
      baseUrl,
      reasoning
    })

    const userEnv = parseEnvironmentVariables(environmentVariables)

    return { env: { ...toolEnv, ...userEnv } }
  }

  const executeLaunch = async (env: Record<string, string>): Promise<boolean> => {
    const resolvedModel = selectedModel ? resolveModel(selectedModel) : null
    if (selectedCliTool !== codeCLI.githubCopilotCli && selectedCliTool !== codeCLI.qoderCli && !resolvedModel) {
      logger.warn('Cannot launch: model could not be resolved')
      window.toast.error(t('code.model_required'))
      return false
    }
    const modelId =
      selectedCliTool === codeCLI.githubCopilotCli || selectedCliTool === codeCLI.qoderCli || !resolvedModel
        ? ''
        : (resolvedModel.apiModelId ?? parseUniqueModelId(resolvedModel.id).modelId)

    const runOptions = {
      autoUpdateToLatest,
      terminal: selectedTerminal
    }

    try {
      const result = await window.api.codeCli.run(selectedCliTool, modelId, currentDirectory, env, runOptions)
      if (result && result.success) {
        setLaunchStatus('success')
        setTimeoutTimer(
          'launchSuccess',
          () => {
            setLaunchStatus((current) => (current === 'success' ? 'idle' : current))
          },
          2500
        )
        window.toast.success(t('code.launch.success'))
        return true
      }
      window.toast.error(result?.message || t('code.launch.error'))
      return false
    } catch (error) {
      logger.error('codeTools.run failed:', error as Error)
      window.toast.error(t('code.launch.error'))
      return false
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

    setLaunchStatus('launching')

    try {
      const result = await prepareLaunchEnvironment()
      if (!result) {
        window.toast.error(t('code.model_required'))
        setLaunchStatus('idle')
        return
      }

      const launched = await executeLaunch(result.env)
      if (!launched) {
        setLaunchStatus('idle')
      }
    } catch (error) {
      logger.error('start code tools failed:', error as Error)
      window.toast.error(t('code.launch.error'))
      setLaunchStatus('idle')
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
    setDialogOpen(true)
  }

  const activeTool = useMemo<CliToolOption | undefined>(
    () => CLI_TOOLS.find((ti) => ti.value === selectedCliTool),
    [selectedCliTool]
  )
  const activeMeta = activeTool ? toMeta(activeTool) : null

  const needsWindowsCustomPath =
    isWin &&
    !!selectedTerminal &&
    selectedTerminal !== terminalApps.cmd &&
    selectedTerminal !== terminalApps.powershell &&
    selectedTerminal !== terminalApps.windowsTerminal

  const activeToolValue = dialogOpen ? selectedCliTool : undefined
  const isLaunching = launchStatus === 'launching'
  const launchSuccess = launchStatus === 'success'

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('code.title')}</NavbarCenter>
      </Navbar>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <CodeToolGallery
          tools={CLI_TOOLS}
          isBunInstalled={!!isBunInstalled}
          isInstallingBun={isInstallingBun}
          handleInstallBun={handleInstallBun}
          activeToolValue={activeToolValue}
          handleSelectTool={handleSelectTool}
          toMeta={toMeta}
        />

        {activeMeta && (
          <Dialog open={dialogOpen} onOpenChange={(next) => !next && setDialogOpen(false)}>
            <DialogContent aria-describedby={undefined}>
              <div ref={setModelSelectorPortalContainer} className="contents">
                <DialogHeader>
                  <DialogTitle>{activeMeta.label}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                  {selectedCliTool !== codeCLI.githubCopilotCli && selectedCliTool !== codeCLI.qoderCli && (
                    <div>
                      <FieldLabel hint={t('code.model_hint')}>{t('code.model')}</FieldLabel>
                      <ModelSelector
                        multiple={false}
                        selectionType="id"
                        value={selectedModelValue}
                        onSelect={handleModelChange}
                        filter={codeCliModelFilter}
                        showTagFilter={false}
                        portalContainer={modelSelectorPortalContainer}
                        trigger={renderModelSelectorTrigger()}
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
                          triggerClassName="data-[state=open]:border-foreground! data-[state=open]:ring-foreground/10!"
                          renderTriggerLeading={<FolderOpen size={11} className="shrink-0 text-muted-foreground" />}
                          renderSelected={(item) => (
                            <span className="truncate font-mono text-foreground">{item.id}</span>
                          )}
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

                  {(isMac || isWin) && terminalItems.length > 0 && (
                    <div>
                      <FieldLabel hint={t('code.terminal_hint')}>{t('code.terminal')}</FieldLabel>
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
                            onClick={() => handleSetCustomPath(selectedTerminal)}
                            className="text-muted-foreground shadow-none hover:text-foreground">
                            <FolderOpen size={10} />
                            {t('code.set_custom_path')}
                          </Button>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
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
                      rows={4}
                      placeholder={'KEY1=value1\nKEY2=value2'}
                      className="min-h-24 resize-none rounded-md border-input px-3 py-2 font-mono text-xs shadow-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/10 md:text-xs [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="code-cli-auto-update"
                      size="sm"
                      checked={autoUpdateToLatest}
                      onCheckedChange={(v) => setAutoUpdateToLatest(v === true)}
                      className="border-input hover:bg-accent data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background [&_[data-slot=checkbox-indicator]>svg]:stroke-background [&_[data-slot=checkbox-indicator]>svg]:text-background"
                    />
                    <Label
                      htmlFor="code-cli-auto-update"
                      className="cursor-pointer font-normal text-muted-foreground text-sm hover:text-foreground">
                      {t('code.auto_update_to_latest')}
                    </Label>
                  </div>
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" disabled={isLaunching}>
                      {t('common.cancel')}
                    </Button>
                  </DialogClose>
                  <Button
                    variant="emphasis"
                    onClick={handleLaunch}
                    loading={isLaunching}
                    disabled={!canLaunch || (selectedCliTool !== codeCLI.qoderCli && !isBunInstalled) || isLaunching}>
                    {launchSuccess ? (
                      <>
                        <Check size={14} />
                        <span>{t('code.launch.launched')}</span>
                      </>
                    ) : isLaunching ? (
                      t('code.launching')
                    ) : (
                      t('code.launch.label')
                    )}
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  )
}

export default CodeCliPage
