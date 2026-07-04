import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { SettingContainer, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import {
  cliConfigConnectionMatchesProvider,
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  readCliConfigDraft,
  readCliConfigFiles,
  updateCliConfigDraftConfig,
  validateCliConfigDraftForWrite
} from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CliConfigEditor } from './CliConfigEditor'
import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { GeminiConfigFields } from './tools/GeminiConfigFields'
import { KimiConfigFields } from './tools/KimiConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'
import { QwenConfigFields } from './tools/QwenConfigFields'

type ConfigDraftMode = 'managed' | 'foreign'

interface ConfigDraft {
  modelId: UniqueModelId | undefined
  config: Record<string, unknown>
  files: CliConfigFileDraft[]
  connection: CliConfigConnection | null
  mode: ConfigDraftMode
  error: string
}

const EMPTY_DRAFT: ConfigDraft = {
  modelId: undefined,
  config: {},
  files: [],
  connection: null,
  mode: 'managed',
  error: ''
}

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  isCurrentProvider: boolean
  /** First model for the provider — used as the selector default when no model is saved. */
  defaultModelId: UniqueModelId | undefined
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    modelId?: UniqueModelId
    config?: Record<string, unknown>
    cliConfigFiles?: CliConfigFileDraft[]
    cliConfigOnly?: boolean
  }) => Promise<void>
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, provider, providerConfig, isCurrentProvider, defaultModelId, modelFilter, onSubmit } =
    props
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)

  const [draft, setDraft] = useState<ConfigDraft>(EMPTY_DRAFT)
  const [submitting, setSubmitting] = useState(false)

  const draftRef = useRef<ConfigDraft>(EMPTY_DRAFT)
  const loadIdRef = useRef(0)
  const apiKeysRef = useRef<Parameters<typeof cliConfigConnectionMatchesProvider>[3]>(undefined)

  const { model: selectedModelRecord } = useModelById(draft.modelId ?? null)

  useEffect(() => {
    apiKeysRef.current = apiKeysData?.keys
  }, [apiKeysData?.keys])

  const commitDraft = useCallback((next: ConfigDraft | ((prev: ConfigDraft) => ConfigDraft)) => {
    const resolved = typeof next === 'function' ? next(draftRef.current) : next
    draftRef.current = resolved
    setDraft(resolved)
  }, [])

  const endpointUrl = getProviderHostTopology(provider).primaryBaseUrl
  const isForeignDraft = draft.mode === 'foreign'
  const displayedProviderName = isForeignDraft
    ? t('code.cli_config.unknown_provider')
    : getProviderDisplayName(provider)
  const displayedEndpointUrl = draft.connection?.baseUrl ?? endpointUrl

  const connectionMatchesProvider = useCallback(
    (connection: CliConfigConnection | null, expectedModelId = draftRef.current.modelId): boolean => {
      const expectedModel =
        expectedModelId && isUniqueModelId(expectedModelId) ? parseUniqueModelId(expectedModelId).modelId : undefined
      return cliConfigConnectionMatchesProvider(cliTool, connection, provider, apiKeysRef.current, expectedModel)
    },
    [cliTool, provider]
  )

  const createManagedDraft = useCallback(
    async (
      nextModelId: UniqueModelId | undefined,
      nextConfig: Record<string, unknown>,
      files?: CliConfigFileDraft[]
    ): Promise<ConfigDraft> => {
      if (!nextModelId) {
        return { modelId: undefined, config: nextConfig, files: [], connection: null, mode: 'managed', error: '' }
      }
      try {
        const nextFiles = await readCliConfigDraft({
          cliTool,
          modelId: nextModelId,
          configBlob: nextConfig,
          files
        })
        return {
          modelId: nextModelId,
          config: nextConfig,
          files: nextFiles,
          connection: null,
          mode: 'managed',
          error: ''
        }
      } catch (error) {
        return {
          modelId: nextModelId,
          config: nextConfig,
          files: files ?? [],
          connection: null,
          mode: 'managed',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    },
    [cliTool]
  )

  const loadManagedDraft = useCallback(
    (nextModelId: UniqueModelId | undefined, nextConfig: Record<string, unknown>, files?: CliConfigFileDraft[]) => {
      const loadId = ++loadIdRef.current
      void createManagedDraft(nextModelId, nextConfig, files).then((nextDraft) => {
        if (loadId !== loadIdRef.current) return
        commitDraft(nextDraft)
      })
    },
    [commitDraft, createManagedDraft]
  )

  useEffect(() => {
    if (!open) return
    const saved = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
    const nextModelId = saved ?? defaultModelId
    const nextConfig = providerConfig?.config ?? {}
    const initialDraft: ConfigDraft = {
      modelId: nextModelId,
      config: nextConfig,
      files: [],
      connection: null,
      mode: 'managed',
      error: ''
    }
    commitDraft(initialDraft)

    if (!nextModelId) return

    const loadId = ++loadIdRef.current
    void (async () => {
      let rawFiles: CliConfigFileDraft[] = []
      try {
        rawFiles = await readCliConfigFiles(cliTool)
        const connection = extractConnectionFromCliConfigDraft(cliTool, rawFiles)

        if (isCurrentProvider && connection && !connectionMatchesProvider(connection, nextModelId)) {
          const nextDraftConfig = extractConfigFromCliConfigDraft(cliTool, rawFiles) ?? nextConfig
          if (loadId !== loadIdRef.current) return
          commitDraft({
            modelId: nextModelId,
            config: nextDraftConfig,
            files: rawFiles,
            connection,
            mode: 'foreign',
            error: ''
          })
          return
        }

        if (isCurrentProvider && !rawFiles.length) {
          if (loadId !== loadIdRef.current) return
          commitDraft(initialDraft)
          return
        }

        const nextDraft = await createManagedDraft(nextModelId, nextConfig, rawFiles)
        if (loadId !== loadIdRef.current) return
        commitDraft(nextDraft)
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        commitDraft({
          ...initialDraft,
          files: rawFiles,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  }, [
    open,
    providerConfig,
    defaultModelId,
    isCurrentProvider,
    cliTool,
    connectionMatchesProvider,
    commitDraft,
    createManagedDraft
  ])

  const canSubmit = isForeignDraft ? draft.files.length > 0 && !draft.error : !!draft.modelId && !draft.error

  const renderModelTrigger = () => (
    <button
      type="button"
      className="group flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {selectedModelRecord ? (
          <>
            <ModelAvatar model={selectedModelRecord} size={18} />
            <span className="truncate text-foreground">{selectedModelRecord.name || selectedModelRecord.id}</span>
          </>
        ) : draft.modelId && isUniqueModelId(draft.modelId) ? (
          <span className="truncate text-foreground">{parseUniqueModelId(draft.modelId).modelId}</span>
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

  const endpointRow: ReactNode = (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-accent/15 px-3 py-2">
      <span
        className={
          isForeignDraft ? 'h-2 w-2 shrink-0 rounded-full bg-warning' : 'h-2 w-2 shrink-0 rounded-full bg-success'
        }
      />
      <span className="shrink-0 font-medium text-foreground text-xs">{displayedProviderName}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/45">
        {displayedEndpointUrl || t('code.endpoint_default')}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/45">{t('code.endpoint_hint')}</span>
    </div>
  )

  const handleModelSelect = useCallback(
    (nextModelId: UniqueModelId | undefined) => {
      const current = draftRef.current
      commitDraft({
        ...current,
        modelId: nextModelId,
        files: nextModelId ? current.files : [],
        connection: null,
        mode: 'managed',
        error: ''
      })
      if (nextModelId) loadManagedDraft(nextModelId, current.config, current.files)
    },
    [commitDraft, loadManagedDraft]
  )

  const unknownCliConfigModelHint: ReactNode =
    isForeignDraft && draft.connection ? (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
        <div className="font-medium text-warning text-xs">{t('code.cli_config.unknown_provider')}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {draft.connection.model || t('code.cli_config.unknown_model')}
        </div>
      </div>
    ) : null

  const modelSlot: ReactNode = (
    <>
      {unknownCliConfigModelHint}
      {unknownCliConfigModelHint && <div className="h-2" />}
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={draft.modelId}
        onSelect={handleModelSelect}
        filter={modelFilter}
        showTagFilter
        trigger={renderModelTrigger()}
      />
      {!unknownCliConfigModelHint && <SettingHelpText className="mt-2">{t('code.model_hint_config')}</SettingHelpText>}
    </>
  )

  const handleConfigChange = useCallback(
    (nextConfig: Record<string, unknown>) => {
      const current = draftRef.current
      if (current.mode === 'foreign') {
        try {
          const nextFiles = updateCliConfigDraftConfig(cliTool, current.files, nextConfig)
          commitDraft({ ...current, config: nextConfig, files: nextFiles, error: '' })
        } catch (error) {
          commitDraft({ ...current, config: nextConfig, error: error instanceof Error ? error.message : String(error) })
        }
      } else {
        commitDraft({ ...current, config: nextConfig, error: '' })
        loadManagedDraft(current.modelId, nextConfig, current.files)
      }
    },
    [cliTool, commitDraft, loadManagedDraft]
  )

  const handleCliConfigFilesChange = useCallback(
    (files: CliConfigFileDraft[]) => {
      const current = draftRef.current
      try {
        validateCliConfigDraftForWrite(files)
      } catch (error) {
        commitDraft({ ...current, files, error: error instanceof Error ? error.message : String(error) })
        return
      }

      const connection = extractConnectionFromCliConfigDraft(cliTool, files)
      const nextConfig = extractConfigFromCliConfigDraft(cliTool, files) ?? current.config
      if (connection && !connectionMatchesProvider(connection, current.modelId)) {
        commitDraft({
          ...current,
          config: nextConfig,
          files,
          connection,
          mode: 'foreign',
          error: ''
        })
      } else {
        commitDraft({
          ...current,
          modelId: connection?.model ? `${provider.id}::${connection.model}` : current.modelId,
          config: nextConfig,
          files,
          connection: null,
          mode: 'managed',
          error: ''
        })
      }
    },
    [cliTool, connectionMatchesProvider, commitDraft, provider.id]
  )

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const current = draftRef.current
    try {
      setSubmitting(true)
      if (current.mode === 'foreign') {
        await onSubmit({ modelId: current.modelId, cliConfigFiles: current.files, cliConfigOnly: true })
      } else if (current.modelId) {
        await onSubmit({ modelId: current.modelId, config: current.config, cliConfigFiles: current.files })
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, onSubmit, onClose])

  const toolFields: ReactNode = (() => {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE:
        return <ClaudeConfigFields config={draft.config} onChange={handleConfigChange} />
      case CodeCli.OPENAI_CODEX:
        return <CodexConfigFields config={draft.config} onChange={handleConfigChange} />
      case CodeCli.OPEN_CODE:
        return <OpenCodeConfigFields config={draft.config} onChange={handleConfigChange} />
      case CodeCli.GEMINI_CLI:
        return <GeminiConfigFields config={draft.config} onChange={handleConfigChange} />
      case CodeCli.QWEN_CODE:
        return <QwenConfigFields config={draft.config} onChange={handleConfigChange} />
      case CodeCli.KIMI_CODE:
        return <KimiConfigFields config={draft.config} onChange={handleConfigChange} />
      default:
        return null
    }
  })()

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('code.configuring_provider', { provider: getProviderDisplayName(provider) })}</DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }} className="gap-5">
          {endpointRow}
          <SettingGroup theme={theme} className="border-t-0 pt-0">
            <SettingTitle className="mb-2.5">{t('code.model')}</SettingTitle>
            {modelSlot}
          </SettingGroup>
          {toolFields && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <SettingTitle className="mb-2.5">{t('code.tool_parameters')}</SettingTitle>
              {toolFields}
            </SettingGroup>
          )}
          {draft.files.length > 0 && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <CliConfigEditor files={draft.files} error={draft.error} onChange={handleCliConfigFilesChange} />
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
