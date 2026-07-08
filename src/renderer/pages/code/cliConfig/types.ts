import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export type CliConfigTarget =
  | 'claude-settings'
  | 'codex-config'
  | 'codex-auth'
  | 'opencode-config'
  | 'gemini-env'
  | 'gemini-settings'
  | 'qwen-settings'
  | 'kimi-config'

export type CliConfigLanguage = 'json' | 'toml' | 'dotenv'

export interface CliConfigFileDraft {
  target: CliConfigTarget
  label: string
  path: string
  language: CliConfigLanguage
  content: string
}

export interface CliConfigConnection {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface CliConfigWriteArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: string
  /** User-edited config blob (claude-code / codex / opencode consume it). */
  configBlob?: Record<string, unknown>
  /** Claude Code only: whether to write env.ANTHROPIC_MODEL. */
  writePrimaryModel?: boolean
}

/** Draft-build inputs: the write args plus an optional set of already-loaded draft files to reparse. */
export type CliConfigDraftBuildArgs = CliConfigWriteArgs & { files?: CliConfigFileDraft[] }

/**
 * Credentials/model/provider resolved from a `CliConfigWriteArgs`, shared by the
 * per-CLI adapters that build and validate config drafts.
 */
export interface ResolvedCliConfigContext {
  provider: Provider
  apiKey: string
  model: string
  modelRecord: Model | null
  configBlob: Record<string, any>
}
