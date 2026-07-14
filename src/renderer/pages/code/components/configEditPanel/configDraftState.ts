import type { CliConfigConnection, CliConfigFileDraft, CliConfigGatewayContext } from '@renderer/pages/code/cliConfig'
import {
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  getClaudeContextModelId,
  hasClaudeDetailedModels,
  readCliConfigDraft,
  readCliConfigFiles,
  sanitizeCliConfigBlob
} from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import type { ClaudeModelMode, ConfigDraft } from './types'

export interface ManagedDraftOptions {
  cliConfigModelId?: UniqueModelId
  writePrimaryModel?: boolean
}

export function createDraftSnapshot(draft: ConfigDraft): string {
  return JSON.stringify({
    modelId: draft.modelId ?? '',
    config: draft.config,
    files: draft.files.map((file) => ({
      target: file.target,
      content: file.content
    })),
    mode: draft.mode,
    connection: draft.connection
      ? {
          baseUrl: draft.connection.baseUrl ?? '',
          apiKey: draft.connection.apiKey ?? '',
          model: draft.connection.model ?? ''
        }
      : null
  })
}

export function createInitialConfigDraftState(
  cliTool: CodeCli,
  providerConfig: CliProviderConfig | null | undefined
): {
  modelId: UniqueModelId | undefined
  config: Record<string, unknown>
  claudeModelMode: ClaudeModelMode
  draft: ConfigDraft
} {
  const modelId = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
  const config = sanitizeCliConfigBlob(cliTool, providerConfig?.config ?? {})
  const claudeModelMode: ClaudeModelMode =
    cliTool === CodeCli.CLAUDE_CODE && hasClaudeDetailedModels(config) ? 'detailed' : 'common'
  return {
    modelId,
    config,
    claudeModelMode,
    draft: {
      modelId,
      config,
      files: [],
      connection: null,
      mode: 'managed',
      error: ''
    }
  }
}

export function isConfigDraftDirty({
  cliTool,
  initialClaudeModelMode,
  initialDraftSnapshot,
  nextDraft,
  nextClaudeModelMode
}: {
  cliTool: CodeCli
  initialClaudeModelMode: ClaudeModelMode
  initialDraftSnapshot: string | undefined
  nextDraft: ConfigDraft
  nextClaudeModelMode: ClaudeModelMode
}): boolean {
  const draftChanged = createDraftSnapshot(nextDraft) !== initialDraftSnapshot
  const commonModeWillClearDetailedModels =
    cliTool === CodeCli.CLAUDE_CODE && initialClaudeModelMode === 'detailed' && nextClaudeModelMode === 'common'
  return draftChanged || commonModeWillClearDetailedModels
}

export function resolveManagedDraftOptions(
  cliTool: CodeCli,
  providerId: string,
  modelMode: ClaudeModelMode,
  config: Record<string, unknown>,
  modelId: UniqueModelId | undefined
): ManagedDraftOptions {
  if (cliTool === CodeCli.CLAUDE_CODE && modelMode === 'detailed') {
    return {
      cliConfigModelId: getClaudeContextModelId(providerId, config),
      writePrimaryModel: false
    }
  }
  return {
    cliConfigModelId: modelId,
    writePrimaryModel: true
  }
}

export async function createManagedConfigDraft({
  cliTool,
  modelId,
  config,
  files,
  options = {},
  gateway
}: {
  cliTool: CodeCli
  modelId: UniqueModelId | undefined
  config: Record<string, unknown>
  files?: CliConfigFileDraft[]
  options?: ManagedDraftOptions
  gateway?: CliConfigGatewayContext
}): Promise<ConfigDraft> {
  const cliConfigModelId = options.cliConfigModelId ?? modelId
  if (!cliConfigModelId) {
    return {
      modelId,
      config,
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
      configBlob: config,
      files,
      writePrimaryModel: options.writePrimaryModel,
      gateway
    })
    return {
      modelId,
      config,
      files: nextFiles,
      connection: null,
      mode: 'managed',
      error: ''
    }
  } catch (error) {
    return {
      modelId,
      config,
      files: files ?? [],
      connection: null,
      mode: 'managed',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function loadInitialConfigDraft({
  cliTool,
  providerId,
  isCurrentProvider,
  initialModelId,
  initialConfig,
  initialClaudeModelMode,
  initialDraftSeed,
  connectionMatchesProvider,
  gateway
}: {
  cliTool: CodeCli
  providerId: string
  isCurrentProvider: boolean
  initialModelId: UniqueModelId | undefined
  initialConfig: Record<string, unknown>
  initialClaudeModelMode: ClaudeModelMode
  initialDraftSeed: ConfigDraft
  connectionMatchesProvider: (connection: CliConfigConnection | null, expectedModelId?: UniqueModelId) => boolean
  gateway?: CliConfigGatewayContext
}): Promise<ConfigDraft> {
  const initialDraftOptions = resolveManagedDraftOptions(
    cliTool,
    providerId,
    initialClaudeModelMode,
    initialConfig,
    initialModelId
  )
  let rawFiles: CliConfigFileDraft[] = []

  try {
    rawFiles = await readCliConfigFiles(cliTool, { includeEmpty: true })

    if (!initialModelId && !initialDraftOptions.cliConfigModelId) {
      return {
        ...initialDraftSeed,
        files: rawFiles
      }
    }

    const connection = extractConnectionFromCliConfigDraft(cliTool, rawFiles)
    const expectedModelId = initialClaudeModelMode === 'detailed' ? undefined : initialModelId

    if (isCurrentProvider && connection && !connectionMatchesProvider(connection, expectedModelId)) {
      return {
        modelId: initialModelId,
        config: extractConfigFromCliConfigDraft(cliTool, rawFiles) ?? initialConfig,
        files: rawFiles,
        connection,
        mode: 'foreign',
        error: ''
      }
    }

    if (isCurrentProvider && !rawFiles.length) {
      return initialDraftSeed
    }

    return createManagedConfigDraft({
      cliTool,
      modelId: initialModelId,
      config: initialConfig,
      files: rawFiles,
      options: initialDraftOptions,
      gateway
    })
  } catch (error) {
    return {
      ...initialDraftSeed,
      files: rawFiles,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
