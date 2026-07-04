import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import {
  cliConfigConnectionMatchesProvider,
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  getClaudeContextModelId,
  sanitizeCliConfigBlob,
  stripClaudeDetailedModels,
  updateCliConfigDraftConfig,
  validateCliConfigDraftForWrite
} from '@renderer/pages/code/cliConfig'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createDraftSnapshot,
  createInitialConfigDraftState,
  createManagedConfigDraft,
  isConfigDraftDirty,
  loadInitialConfigDraft,
  resolveManagedDraftOptions
} from './configDraftState'
import type { ClaudeModelMode, ConfigDraft, ConfigEditPanelProps } from './types'

interface ConfigDraftControllerOptions
  extends Pick<ConfigEditPanelProps, 'cliTool' | 'provider' | 'providerConfig' | 'isCurrentProvider' | 'onSubmit'> {
  apiKeys?: Parameters<typeof cliConfigConnectionMatchesProvider>[3]
  onClose: () => void
}

interface ConfigDraftController {
  draft: ConfigDraft
  claudeModelMode: ClaudeModelMode
  isForeignDraft: boolean
  submitting: boolean
  canSave: boolean
  onModelSelect: (nextModelId: UniqueModelId | undefined) => void
  onConfigChange: (nextConfig: Record<string, unknown>) => void
  onClaudeModelModeChange: (nextMode: ClaudeModelMode) => void
  onCliConfigFilesChange: (files: CliConfigFileDraft[]) => void
  onSubmit: () => void
}

/* oxlint-disable react-doctor/no-event-handler -- ConfigEditPanel is keyed by tool/provider, so prop changes remount instead of driving event-like effects. */
export function useConfigDraftController({
  onClose,
  cliTool,
  provider,
  providerConfig,
  isCurrentProvider,
  apiKeys,
  onSubmit
}: ConfigDraftControllerOptions): ConfigDraftController {
  const initialState = createInitialConfigDraftState(cliTool, providerConfig)
  const initialModelId = initialState.modelId
  const initialConfig = initialState.config
  const initialClaudeModelMode = initialState.claudeModelMode
  const initialDraftSeed = initialState.draft

  const [draft, setDraft] = useState<ConfigDraft>(initialDraftSeed)
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

  /* oxlint-disable react-doctor/no-pass-data-to-parent -- Reads external CLI config files after the keyed dialog mounts and commits the loaded local draft state. */
  useEffect(() => {
    apiKeysRef.current = apiKeys
  }, [apiKeys])

  const computeIsDirty = useCallback(
    (nextDraft: ConfigDraft, modelMode = claudeModelModeRef.current) => {
      return isConfigDraftDirty({
        cliTool,
        initialClaudeModelMode: initialClaudeModelModeRef.current,
        initialDraftSnapshot: initialDraftSnapshotRef.current,
        nextDraft,
        nextClaudeModelMode: modelMode
      })
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

  const resolveManagedOptions = useCallback(
    (modelMode: ClaudeModelMode, config: Record<string, unknown>, modelId: UniqueModelId | undefined) =>
      resolveManagedDraftOptions(cliTool, provider.id, modelMode, config, modelId),
    [cliTool, provider.id]
  )

  const createManagedDraft = useCallback(
    async (
      nextModelId: UniqueModelId | undefined,
      nextConfig: Record<string, unknown>,
      files?: CliConfigFileDraft[],
      options: { cliConfigModelId?: UniqueModelId; writePrimaryModel?: boolean } = {}
    ): Promise<ConfigDraft> =>
      createManagedConfigDraft({
        cliTool,
        modelId: nextModelId,
        config: nextConfig,
        files,
        options
      }),
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
    providerId: provider.id,
    connectionMatchesProvider,
    initialModelId,
    initialConfig,
    initialClaudeModelMode,
    initialDraftSeed
  })

  useEffect(() => {
    const {
      isCurrentProvider,
      cliTool,
      providerId,
      connectionMatchesProvider,
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
    const loadId = ++loadIdRef.current
    void loadInitialConfigDraft({
      cliTool,
      providerId,
      isCurrentProvider,
      initialModelId,
      initialConfig,
      initialClaudeModelMode,
      initialDraftSeed,
      connectionMatchesProvider
    }).then((nextDraft) => {
      if (loadId !== loadIdRef.current) return
      commitLoadedDraft(nextDraft)
    })
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
          resolveManagedOptions(claudeModelMode, sanitizedConfig, current.modelId)
        )
      }
    },
    [claudeModelMode, cliTool, commitDraft, loadManagedDraft, resolveManagedOptions]
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

  return {
    draft,
    claudeModelMode,
    isForeignDraft,
    submitting,
    canSave,
    onModelSelect: handleModelSelect,
    onConfigChange: handleConfigChange,
    onClaudeModelModeChange: handleClaudeModelModeChange,
    onCliConfigFilesChange: handleCliConfigFilesChange,
    onSubmit: handleSubmit
  }
}
/* oxlint-enable react-doctor/no-event-handler */
