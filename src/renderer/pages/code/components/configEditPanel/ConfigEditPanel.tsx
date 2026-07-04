import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ModelSelector } from '@renderer/components/Selector/model'
import { getProviderDisplayName, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  getClaudeContextModelId,
  hasClaudeDetailedModels,
  stripClaudeDetailedModels
} from '@renderer/pages/code/cliConfig/claudeModels'
import { readCliConfigDraft, readCliConfigFiles } from '@renderer/pages/code/cliConfig/draft'
import { validateCliConfigDraftForWrite } from '@renderer/pages/code/cliConfig/draftFiles'
import { updateCliConfigDraftConfig } from '@renderer/pages/code/cliConfig/draftUpdater'
import {
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft
} from '@renderer/pages/code/cliConfig/parser'
import { cliConfigConnectionMatchesProvider } from '@renderer/pages/code/cliConfig/providerMatching'
import { sanitizeCliConfigBlob } from '@renderer/pages/code/cliConfig/sanitize'
import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig/types'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import type { ComponentProps, FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigEditDialogBody } from './ConfigEditDialogBody'
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
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  isCurrentProvider: boolean
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    modelId?: UniqueModelId
    cliConfigModelId?: UniqueModelId
    config?: Record<string, unknown>
    cliConfigFiles?: CliConfigFileDraft[]
    cliConfigOnly?: boolean
    writePrimaryModel?: boolean
  }) => Promise<void>
}

function renderToolFields({
  cliTool,
  config,
  onChange,
  section,
  providerId,
  modelFilter
}: {
  cliTool: CodeCli
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section: 'basic' | 'advanced'
  providerId: string
  modelFilter: (model: Model) => boolean
}): ReactNode {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      if (section === 'advanced') return null
      return (
        <ClaudeConfigFields
          config={config}
          onChange={onChange}
          section={section}
          providerId={providerId}
          modelFilter={modelFilter}
        />
      )
    case CodeCli.OPENAI_CODEX:
      return <CodexConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.OPEN_CODE:
      return <OpenCodeConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.GEMINI_CLI:
      return <GeminiConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.QWEN_CODE:
      return <QwenConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.KIMI_CODE:
      return <KimiConfigFields config={config} onChange={onChange} section={section} />
    default:
      return null
  }
}

function renderClaudeDetailedModelSlot({
  hint,
  config,
  onChange,
  providerId,
  modelFilter
}: {
  hint: ReactNode
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  providerId: string
  modelFilter: (model: Model) => boolean
}): ReactNode {
  return (
    <>
      {hint}
      {hint && <div className="h-2" />}
      <ClaudeConfigFields
        config={config}
        onChange={onChange}
        section="advanced"
        providerId={providerId}
        modelFilter={modelFilter}
      />
    </>
  )
}

/* oxlint-disable react-doctor/no-event-handler -- ConfigEditPanel is keyed by tool/provider, so prop changes remount instead of driving event-like effects. */
function useConfigEditPanelBodyProps({
  onClose,
  cliTool,
  provider,
  providerConfig,
  isCurrentProvider,
  modelFilter,
  onSubmit
}: ConfigEditPanelProps): ComponentProps<typeof ConfigEditDialogBody> {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)
  const initialModelId = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
  const initialConfig = sanitizeCliConfigBlob(cliTool, providerConfig?.config ?? {})
  const initialClaudeModelMode: ClaudeModelMode =
    cliTool === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(initialConfig) ? 'detailed' : 'common'
  const initialDraftSeed: ConfigDraft = {
    modelId: initialModelId,
    config: initialConfig,
    files: [],
    connection: null,
    mode: 'managed',
    error: ''
  }

  const [draft, setDraft] = useState<ConfigDraft>(initialDraftSeed)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [claudeModelMode, setClaudeModelMode] = useState<ClaudeModelMode>(initialClaudeModelMode)
  const [submitting, setSubmitting] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const draftRef = useRef<ConfigDraft>(initialDraftSeed)
  const initialDraftSnapshotRef = useRef<string | undefined>(undefined)
  const claudeModelModeRef = useRef<ClaudeModelMode>(initialClaudeModelMode)
  const initialClaudeModelModeRef = useRef<ClaudeModelMode>(initialClaudeModelMode)
  const loadIdRef = useRef(0)
  const apiKeysRef = useRef<Parameters<typeof cliConfigConnectionMatchesProvider>[3]>(undefined)

  if (initialDraftSnapshotRef.current === undefined) {
    initialDraftSnapshotRef.current = createDraftSnapshot(initialDraftSeed)
  }

  const providerName = getProviderDisplayName(provider)
  const providerIcon = resolveProviderIcon(provider.id)

  /* oxlint-disable react-doctor/no-pass-data-to-parent -- Reads external CLI config files after the keyed dialog mounts and commits the loaded local draft state. */
  useEffect(() => {
    apiKeysRef.current = apiKeysData?.keys
  }, [apiKeysData?.keys])

  const computeIsDirty = useCallback(
    (nextDraft: ConfigDraft, modelMode = claudeModelModeRef.current) => {
      const draftChanged = createDraftSnapshot(nextDraft) !== initialDraftSnapshotRef.current
      const commonModeWillClearDetailedModels =
        cliTool === CodeCli.CLAUDE_CODE && initialClaudeModelModeRef.current === 'detailed' && modelMode === 'common'
      return draftChanged || commonModeWillClearDetailedModels
    },
    [cliTool]
  )

  const commitDraft = useCallback(
    (next: ConfigDraft | ((prev: ConfigDraft) => ConfigDraft)) => {
      const resolved = typeof next === 'function' ? next(draftRef.current) : next
      draftRef.current = resolved
      setDraft(resolved)
      setIsDirty(computeIsDirty(resolved))
    },
    [computeIsDirty]
  )

  const isForeignDraft = draft.mode === 'foreign'

  const connectionMatchesProvider = useCallback(
    (connection: CliConfigConnection | null, expectedModelId = draftRef.current.modelId): boolean => {
      const expectedModel =
        expectedModelId && isUniqueModelId(expectedModelId) ? parseUniqueModelId(expectedModelId).modelId : undefined
      return cliConfigConnectionMatchesProvider(cliTool, connection, provider, apiKeysRef.current, expectedModel)
    },
    [cliTool, provider]
  )

  const resolveManagedDraftOptions = useCallback(
    (
      modelMode: ClaudeModelMode,
      config: Record<string, unknown>,
      modelId: UniqueModelId | undefined
    ): { cliConfigModelId?: UniqueModelId; writePrimaryModel?: boolean } => {
      if (cliTool === CodeCli.CLAUDE_CODE && modelMode === 'detailed') {
        return {
          cliConfigModelId: getClaudeContextModelId(provider.id, config),
          writePrimaryModel: false
        }
      }
      return {
        cliConfigModelId: modelId,
        writePrimaryModel: true
      }
    },
    [cliTool, provider.id]
  )

  const createManagedDraft = useCallback(
    async (
      nextModelId: UniqueModelId | undefined,
      nextConfig: Record<string, unknown>,
      files?: CliConfigFileDraft[],
      options: { cliConfigModelId?: UniqueModelId; writePrimaryModel?: boolean } = {}
    ): Promise<ConfigDraft> => {
      const cliConfigModelId = options.cliConfigModelId ?? nextModelId
      if (!cliConfigModelId) {
        return {
          modelId: nextModelId,
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
          modelId: cliConfigModelId,
          configBlob: nextConfig,
          files,
          writePrimaryModel: options.writePrimaryModel
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
    (
      nextModelId: UniqueModelId | undefined,
      nextConfig: Record<string, unknown>,
      files?: CliConfigFileDraft[],
      options?: { cliConfigModelId?: UniqueModelId; writePrimaryModel?: boolean }
    ) => {
      const loadId = ++loadIdRef.current
      void createManagedDraft(nextModelId, nextConfig, files, options).then((nextDraft) => {
        if (loadId !== loadIdRef.current) return
        commitDraft(nextDraft)
      })
    },
    [commitDraft, createManagedDraft]
  )

  const initialLoadContextRef = useRef({
    isCurrentProvider,
    cliTool,
    connectionMatchesProvider,
    createManagedDraft,
    resolveManagedDraftOptions,
    initialModelId,
    initialConfig,
    initialClaudeModelMode,
    initialDraftSeed
  })

  useEffect(() => {
    const {
      isCurrentProvider,
      cliTool,
      connectionMatchesProvider,
      createManagedDraft,
      resolveManagedDraftOptions,
      initialModelId,
      initialConfig,
      initialClaudeModelMode,
      initialDraftSeed
    } = initialLoadContextRef.current
    const commitLoadedDraft = (nextDraft: ConfigDraft) => {
      draftRef.current = nextDraft
      initialDraftSnapshotRef.current = createDraftSnapshot(nextDraft)
      setDraft(nextDraft)
      setIsDirty(false)
    }
    const initialDraftOptions = resolveManagedDraftOptions(initialClaudeModelMode, initialConfig, initialModelId)

    const loadId = ++loadIdRef.current
    void (async () => {
      let rawFiles: CliConfigFileDraft[] = []
      try {
        rawFiles = await readCliConfigFiles(cliTool, { includeEmpty: true })

        if (!initialModelId && !initialDraftOptions.cliConfigModelId) {
          if (loadId !== loadIdRef.current) return
          commitLoadedDraft({
            ...initialDraftSeed,
            files: rawFiles
          })
          return
        }

        const connection = extractConnectionFromCliConfigDraft(cliTool, rawFiles)
        const expectedModelId = initialClaudeModelMode === 'detailed' ? undefined : initialModelId

        if (isCurrentProvider && connection && !connectionMatchesProvider(connection, expectedModelId)) {
          const nextDraftConfig = extractConfigFromCliConfigDraft(cliTool, rawFiles) ?? initialConfig
          if (loadId !== loadIdRef.current) return
          commitLoadedDraft({
            modelId: initialModelId,
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
          commitLoadedDraft(initialDraftSeed)
          return
        }

        const nextDraft = await createManagedDraft(initialModelId, initialConfig, rawFiles, initialDraftOptions)
        if (loadId !== loadIdRef.current) return
        commitLoadedDraft(nextDraft)
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        commitLoadedDraft({
          ...initialDraftSeed,
          files: rawFiles,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  }, [])
  /* oxlint-enable react-doctor/no-pass-data-to-parent */

  const canSubmit = isForeignDraft ? draft.files.length > 0 && !draft.error : !draft.error
  const canSave = canSubmit && isDirty

  const handleModelSelect = useCallback(
    (nextModelId: UniqueModelId | undefined) => {
      const current = draftRef.current
      const nextConfig = cliTool === CodeCli.CLAUDE_CODE ? stripClaudeDetailedModels(current.config) : current.config
      commitDraft({
        ...current,
        modelId: nextModelId,
        config: nextConfig,
        files: current.files,
        connection: null,
        mode: 'managed',
        error: ''
      })
      if (nextModelId) {
        loadManagedDraft(nextModelId, nextConfig, current.files, {
          cliConfigModelId: nextModelId,
          writePrimaryModel: true
        })
      }
    },
    [cliTool, commitDraft, loadManagedDraft]
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
      const sanitizedConfig = sanitizeCliConfigBlob(cliTool, nextConfig)
      const current = draftRef.current
      if (current.mode === 'foreign') {
        try {
          const nextFiles = updateCliConfigDraftConfig(cliTool, current.files, sanitizedConfig)
          commitDraft({ ...current, config: sanitizedConfig, files: nextFiles, error: '' })
        } catch (error) {
          commitDraft({
            ...current,
            config: sanitizedConfig,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      } else {
        commitDraft({ ...current, config: sanitizedConfig, error: '' })
        loadManagedDraft(
          current.modelId,
          sanitizedConfig,
          current.files,
          resolveManagedDraftOptions(claudeModelMode, sanitizedConfig, current.modelId)
        )
      }
    },
    [claudeModelMode, cliTool, commitDraft, loadManagedDraft, resolveManagedDraftOptions]
  )

  const handleClaudeModelModeChange = useCallback(
    (nextMode: ClaudeModelMode) => {
      if (nextMode === claudeModelMode) return
      claudeModelModeRef.current = nextMode
      setClaudeModelMode(nextMode)
      setIsDirty(computeIsDirty(draftRef.current, nextMode))
    },
    [claudeModelMode, computeIsDirty]
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
      const nextConfig = sanitizeCliConfigBlob(
        cliTool,
        extractConfigFromCliConfigDraft(cliTool, files) ?? current.config
      )
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
        await onSubmit({
          ...(current.modelId ? { modelId: current.modelId } : {}),
          cliConfigFiles: current.files,
          cliConfigOnly: true
        })
      } else {
        const isClaudeDetailedSubmit = cliTool === CodeCli.CLAUDE_CODE && claudeModelMode === 'detailed'
        const sanitizedConfig = sanitizeCliConfigBlob(cliTool, current.config)
        const cliConfigModelId = isClaudeDetailedSubmit
          ? getClaudeContextModelId(provider.id, sanitizedConfig)
          : current.modelId
        const nextConfig =
          cliTool === CodeCli.CLAUDE_CODE && !isClaudeDetailedSubmit
            ? stripClaudeDetailedModels(sanitizedConfig)
            : sanitizedConfig
        const submitDraft = cliConfigModelId
          ? await createManagedDraft(current.modelId, nextConfig, current.files, {
              cliConfigModelId,
              writePrimaryModel: !isClaudeDetailedSubmit
            })
          : null
        if (submitDraft?.error) {
          commitDraft(submitDraft)
          return
        }
        await onSubmit({
          modelId: isClaudeDetailedSubmit ? undefined : current.modelId,
          cliConfigModelId,
          config: nextConfig,
          ...(submitDraft ? { cliConfigFiles: submitDraft.files } : {}),
          writePrimaryModel: !isClaudeDetailedSubmit
        })
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSave, claudeModelMode, cliTool, commitDraft, createManagedDraft, onSubmit, onClose, provider.id])

  const isClaudeTool = cliTool === CodeCli.CLAUDE_CODE
  const claudeDetailedModelSlot = isClaudeTool
    ? renderClaudeDetailedModelSlot({
        hint: unknownCliConfigModelHint,
        config: draft.config,
        onChange: handleConfigChange,
        providerId: provider.id,
        modelFilter
      })
    : null
  const modelSectionSlot = isClaudeTool && claudeModelMode === 'detailed' ? claudeDetailedModelSlot : modelSlot
  const advancedFields = renderToolFields({
    cliTool,
    config: draft.config,
    onChange: handleConfigChange,
    section: 'advanced',
    providerId: provider.id,
    modelFilter
  })
  const toolFields = renderToolFields({
    cliTool,
    config: draft.config,
    onChange: handleConfigChange,
    section: 'basic',
    providerId: provider.id,
    modelFilter
  })
  const hasAdvancedSection = !!advancedFields || draft.files.length > 0

  return {
    open: true,
    onClose,
    provider,
    providerName,
    providerIcon,
    theme,
    isClaudeTool,
    claudeModelMode,
    onClaudeModelModeChange: handleClaudeModelModeChange,
    modelSectionSlot,
    toolFields,
    advancedFields,
    hasAdvancedSection,
    advancedOpen,
    onAdvancedToggle: () => setAdvancedOpen((o) => !o),
    files: draft.files,
    error: draft.error,
    onFilesChange: handleCliConfigFilesChange,
    submitting,
    canSave,
    onSubmit: handleSubmit
  }
}
/* oxlint-enable react-doctor/no-event-handler */

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const bodyProps = useConfigEditPanelBodyProps(props)
  return <ConfigEditDialogBody {...bodyProps} />
}
