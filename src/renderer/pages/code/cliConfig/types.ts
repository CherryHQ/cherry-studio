import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CliConfigLanguage, CliConfigTarget } from '@shared/utils/cliConfig'

export type { CliConfigLanguage, CliConfigTarget }

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

/**
 * Cherry-gateway resolution override. When present, config resolution uses the synthetic
 * gateway provider (endpointConfigs → local gateway URL) + this key instead of the real
 * provider parsed from `modelId`, and writes the gateway-addressed model id — so the real
 * provider key never lands in the CLI config file.
 */
export interface CliConfigGatewayContext {
  provider: Provider
  /** The gateway secret key (`Provider.apiKeys` omits key values by schema, so it's carried here). */
  apiKey: string
}

export interface CliConfigWriteArgs {
  cliTool: string
  /** Unique model id ("providerId::modelId"). */
  modelId: UniqueModelId
  /** User-edited config blob (claude-code / codex / opencode consume it). */
  configBlob?: Record<string, unknown>
  /** Claude Code only: whether to write env.ANTHROPIC_MODEL. */
  writePrimaryModel?: boolean
  /** Present when the selected provider is the Cherry gateway (see {@link CliConfigGatewayContext}). */
  gateway?: CliConfigGatewayContext
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
