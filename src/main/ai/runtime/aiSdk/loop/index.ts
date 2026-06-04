import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { AiPlugin } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type {
  Experimental_DownloadFunction as DownloadFunction,
  ModelMessage,
  PrepareStepFunction,
  StepResult,
  StopCondition,
  TelemetrySettings,
  ToolCallRepairFunction,
  ToolChoice,
  ToolSet
} from 'ai'

import type { AppProviderSettingsMap } from '../../../types'

type AppProviderKey = StringKeys<AppProviderSettingsMap>

// ── Hooks ───────────────────────────────────────────────────────────

export interface ErrorContext {
  error: Error
}

/**
 * Tool execution events — shaped to match AI SDK v7's
 * `experimental_onToolExecutionStart/End` so the v6 wrapper can be
 * swapped for a direct forward when we upgrade.
 */
export interface ToolExecutionStartEvent {
  /** Matches v7 naming. */
  callId: string
  toolName: string
  input: unknown
  messages: ModelMessage[]
}

export type ToolExecutionEndEvent = ToolExecutionStartEvent & {
  /** Wall-clock duration of the tool's `execute` only. */
  durationMs: number
  toolOutput: { type: 'tool-result'; output: unknown } | { type: 'tool-error'; error: unknown }
}

export interface AgentLoopHooks {
  onStart?: () => Promise<void> | void

  /** Forwarded to AI SDK `prepareStep`. */
  prepareStep?: PrepareStepFunction

  onStepFinish?: (step: StepResult<ToolSet>) => Promise<void> | void

  onToolExecutionStart?: (event: ToolExecutionStartEvent) => Promise<void> | void
  /** `durationMs` excludes hook latency. */
  onToolExecutionEnd?: (event: ToolExecutionEndEvent) => Promise<void> | void

  /** Aggregate per-run state in your own `onStepFinish`; read it here via closure. */
  onFinish?: () => Promise<void> | void

  /** Return 'retry' to retry the run, 'abort' to stop. Default: 'abort'. Retry is not implemented yet. */
  onError?: (ctx: ErrorContext) => Promise<'retry' | 'abort'> | 'retry' | 'abort'
}

// ── Agent options ───────────────────────────────────────────────────

export interface AgentOptions {
  // CallSettings
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
  maxRetries?: number
  timeout?: number | { totalMs?: number; stepMs?: number; chunkMs?: number }
  headers?: Record<string, string | undefined>

  // Agent-specific
  toolChoice?: ToolChoice<ToolSet>
  /** Dynamic subset of tools without changing the type. */
  activeTools?: string[]
  providerOptions?: ProviderOptions
  /** Custom context passed to tool execute functions. */
  context?: unknown
  /** Repair tool calls that fail to parse. */
  repairToolCall?: ToolCallRepairFunction<ToolSet>
  /** Download fallback when the model doesn't support a media type directly. */
  download?: DownloadFunction

  // Loop control
  /** Default: AI SDK default (`stepCountIs(20)`). */
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  telemetry?: TelemetrySettings
}

// ── Params ──────────────────────────────────────────────────────────

export interface AgentLoopParams<T extends AppProviderKey = AppProviderKey> {
  providerId: T
  providerSettings: AppProviderSettingsMap[T]
  modelId: string
  /** Stable id for the first assistant UIMessage emitted by this execution. */
  messageId?: string
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string
  options?: AgentOptions
  /** Independent hook contributors folded by `composeHooks`. */
  hookParts?: ReadonlyArray<Partial<AgentLoopHooks>>
}
