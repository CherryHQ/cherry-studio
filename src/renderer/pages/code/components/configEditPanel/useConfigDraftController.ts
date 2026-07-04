import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import {
  cliConfigConnectionMatchesProvider,
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  getClaudeContextModelId,
  hasClaudeDetailedModels,
  readCliConfigDraft,
  readCliConfigFiles,
  sanitizeCliConfigBlob,
  stripClaudeDetailedModels,
  updateCliConfigDraftConfig,
  validateCliConfigDraftForWrite
} from '@renderer/pages/code/cliConfig'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createDraftSnapshot } from './draftSnapshot'
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
