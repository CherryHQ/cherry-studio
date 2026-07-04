import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SegmentedControl
} from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { SettingContainer, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
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
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from './AdvancedConfigToggle'
import { CliConfigEditor } from './CliConfigEditor'
import { ModelSelectorTrigger } from './ModelSelectorTrigger'
import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { GeminiConfigFields } from './tools/GeminiConfigFields'
import { KimiConfigFields } from './tools/KimiConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'
import { QwenConfigFields } from './tools/QwenConfigFields'

type ConfigDraftMode = 'managed' | 'foreign'
type ClaudeModelMode = 'common' | 'detailed'

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

function normalizeDraftForDirtyCheck(draft: ConfigDraft) {
  return {
    modelId: draft.modelId,
    config: draft.config,
    files: draft.files.map((file) => ({
      target: file.target,
      label: file.label,
      path: file.path,
      language: file.language,
      content: file.content
    })),
    mode: draft.mode
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  )
}

function createDraftSnapshot(draft: ConfigDraft): string {
  return JSON.stringify(sortJsonValue(normalizeDraftForDirtyCheck(draft)))
}

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  isCurrentProvider: boolean
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    modelId?: UniqueModelId
    config?: Record<string, unknown>
    cliConfigFiles?: CliConfigFileDraft[]
    cliConfigOnly?: boolean
  }) => Promise<void>
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, provider, providerConfig, isCurrentProvider, modelFilter, onSubmit } = props
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)

  const [draft, setDraft] = useState<ConfigDraft>(EMPTY_DRAFT)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [claudeModelMode, setClaudeModelMode] = useState<ClaudeModelMode>('common')
  const [submitting, setSubmitting] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const draftRef = useRef<ConfigDraft>(EMPTY_DRAFT)
  const initialDraftSnapshotRef = useRef(createDraftSnapshot(EMPTY_DRAFT))
  const loadIdRef = useRef(0)
  const apiKeysRef = useRef<Parameters<typeof cliConfigConnectionMatchesProvider>[3]>(undefined)

  const providerName = getProviderDisplayName(provider)
  const providerIcon = resolveProviderIcon(provider.id)

  useEffect(() => {
    apiKeysRef.current = apiKeysData?.keys
  }, [apiKeysData?.keys])

  const commitDraft = useCallback((next: ConfigDraft | ((prev: ConfigDraft) => ConfigDraft)) => {
    const resolved = typeof next === 'function' ? next(draftRef.current) : next
    draftRef.current = resolved
    setDraft(resolved)
    setIsDirty(createDraftSnapshot(resolved) !== initialDraftSnapshotRef.current)
  }, [])

  const commitCleanDraft = useCallback((next: ConfigDraft | ((prev: ConfigDraft) => ConfigDraft)) => {
    const resolved = typeof next === 'function' ? next(draftRef.current) : next
    draftRef.current = resolved
    initialDraftSnapshotRef.current = createDraftSnapshot(resolved)
    setDraft(resolved)
    setIsDirty(false)
  }, [])

  const isForeignDraft = draft.mode === 'foreign'

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
        return {
          modelId: undefined,
          config: nextConfig,
          files: files ?? [],
          connection: null,
          mode: 'managed',
          error: ''
        }
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
    setAdvancedOpen(false)
    setClaudeModelMode('common')
    const saved = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
    const nextModelId = saved
    const nextConfig = providerConfig?.config ?? {}
    const initialDraft: ConfigDraft = {
      modelId: nextModelId,
      config: nextConfig,
      files: [],
      connection: null,
      mode: 'managed',
      error: ''
    }
    commitCleanDraft(initialDraft)

    const loadId = ++loadIdRef.current
    void (async () => {
      let rawFiles: CliConfigFileDraft[] = []
      try {
        rawFiles = await readCliConfigFiles(cliTool, { includeEmpty: true })

        if (!nextModelId) {
          if (loadId !== loadIdRef.current) return
          commitCleanDraft({
            ...initialDraft,
            files: rawFiles
          })
          return
        }

        const connection = extractConnectionFromCliConfigDraft(cliTool, rawFiles)

        if (isCurrentProvider && connection && !connectionMatchesProvider(connection, nextModelId)) {
          const nextDraftConfig = extractConfigFromCliConfigDraft(cliTool, rawFiles) ?? nextConfig
          if (loadId !== loadIdRef.current) return
          commitCleanDraft({
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
          commitCleanDraft(initialDraft)
          return
        }

        const nextDraft = await createManagedDraft(nextModelId, nextConfig, rawFiles)
        if (loadId !== loadIdRef.current) return
        commitCleanDraft(nextDraft)
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        commitCleanDraft({
          ...initialDraft,
          files: rawFiles,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  }, [
    open,
    providerConfig,
    isCurrentProvider,
    cliTool,
    connectionMatchesProvider,
    commitCleanDraft,
    createManagedDraft
  ])

  const canSubmit = isForeignDraft ? draft.files.length > 0 && !draft.error : !!draft.modelId && !draft.error
  const canSave = canSubmit && isDirty

  const handleModelSelect = useCallback(
    (nextModelId: UniqueModelId | undefined) => {
      const current = draftRef.current
      commitDraft({
        ...current,
        modelId: nextModelId,
        files: current.files,
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
        trigger={<ModelSelectorTrigger value={draft.modelId} placeholder={t('settings.models.empty')} />}
      />
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
    if (!canSave) return
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
  }, [canSave, onSubmit, onClose])

  const renderToolFields = (section: 'basic' | 'advanced'): ReactNode => {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE:
        if (section === 'advanced') return null
        return (
          <ClaudeConfigFields
            config={draft.config}
            onChange={handleConfigChange}
            section={section}
            providerId={provider.id}
            currentModelId={draft.modelId}
            modelFilter={modelFilter}
          />
        )
      case CodeCli.OPENAI_CODEX:
        return <CodexConfigFields config={draft.config} onChange={handleConfigChange} section={section} />
      case CodeCli.OPEN_CODE:
        return <OpenCodeConfigFields config={draft.config} onChange={handleConfigChange} section={section} />
      case CodeCli.GEMINI_CLI:
        return <GeminiConfigFields config={draft.config} onChange={handleConfigChange} section={section} />
      case CodeCli.QWEN_CODE:
        return <QwenConfigFields config={draft.config} onChange={handleConfigChange} section={section} />
      case CodeCli.KIMI_CODE:
        return <KimiConfigFields config={draft.config} onChange={handleConfigChange} section={section} />
      default:
        return null
    }
  }

  const isClaudeTool = cliTool === CodeCli.CLAUDE_CODE
  const claudeDetailedModelSlot: ReactNode = isClaudeTool ? (
    <>
      {unknownCliConfigModelHint}
      {unknownCliConfigModelHint && <div className="h-2" />}
      <ClaudeConfigFields
        config={draft.config}
        onChange={handleConfigChange}
        section="advanced"
        providerId={provider.id}
        currentModelId={draft.modelId}
        modelFilter={modelFilter}
        onDefaultModelSelect={handleModelSelect}
      />
    </>
  ) : null
  const modelSectionSlot = isClaudeTool && claudeModelMode === 'detailed' ? claudeDetailedModelSlot : modelSlot
  const advancedFields = renderToolFields('advanced')
  const toolFields = renderToolFields('basic')
  const hasAdvancedSection = !!advancedFields || draft.files.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <ProviderAvatarPrimitive
              providerId={provider.id}
              providerName={providerName}
              logo={providerIcon}
              size={22}
              className="shrink-0 rounded-md border border-border/30 [&_[data-slot=avatar-fallback]]:rounded-[inherit] [&_[data-slot=avatar-image]]:rounded-[inherit]"
            />
            <span className="min-w-0 truncate">{providerName}</span>
          </DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }} className="gap-5 p-0">
          <SettingGroup theme={theme} className="border-t-0 pt-0">
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-3">
              <SettingTitle className="mb-0 min-w-0">{t('code.model_selection')}</SettingTitle>
              {isClaudeTool && (
                <SegmentedControl<ClaudeModelMode>
                  size="sm"
                  value={claudeModelMode}
                  onValueChange={setClaudeModelMode}
                  options={[
                    { value: 'common', label: t('code.model_mode.common') },
                    { value: 'detailed', label: t('code.model_mode.detailed') }
                  ]}
                />
              )}
            </div>
            {modelSectionSlot}
          </SettingGroup>
          {toolFields && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <SettingTitle className="mb-2.5">{t('code.tool_parameters')}</SettingTitle>
              {toolFields}
            </SettingGroup>
          )}
          {hasAdvancedSection && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
                <div className="space-y-5">
                  {advancedFields}
                  {draft.files.length > 0 && (
                    <CliConfigEditor files={draft.files} error={draft.error} onChange={handleCliConfigFilesChange} />
                  )}
                </div>
              </AdvancedConfigToggle>
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSave} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
