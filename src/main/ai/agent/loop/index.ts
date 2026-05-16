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

import type { AppProviderSettingsMap } from '../../types'
import type { PendingMessageQueue } from './PendingMessageQueue'

type AppProviderKey = StringKeys<AppProviderSettingsMap>

// ── Hooks: lifecycle extension points ──

export interface ErrorContext {
  error: Error
}

// ── Tool execution events (ported from AI SDK v7 design) ──
//
// AI SDK v6's `ToolLoopAgentSettings` does NOT expose tool-level callbacks —
// `onStepFinish` is the closest, but it fires per LLM step (post tool batch)
// and lacks per-call `durationMs`. v7 introduces
// `experimental_onToolExecutionStart/End` on the Agent layer; we mirror that
// shape here and dispatch from a wrapper around each tool's `execute`. When
// we eventually upgrade to v7, swap the wrapper for a direct forward to
// `agentSettings.experimental_onToolExecution*` and the hook signatures stay
// stable.

export interface ToolExecutionStartEvent {
  /** Same as `toolCallId`; named `callId` to match v7. */
  callId: string
  toolName: string
  /** Tool call arguments parsed from the model output. */
  input: unknown
  /** Messages sent to the model that produced this tool call. */
  messages: ModelMessage[]
}

export type ToolExecutionEndEvent = ToolExecutionStartEvent & {
  /** Wall-clock duration of the tool's `execute` function only. */
  durationMs: number
  toolOutput: { type: 'tool-result'; output: unknown } | { type: 'tool-error'; error: unknown }
}

export interface AgentLoopHooks {
  /** Before the run starts. Use for: otel root span, load memory */
  onStart?: () => Promise<void> | void

  /** Forwarded to AI SDK prepareStep. Use for: tail pruning, conditional context.
   *  Cherry's internal steering observer (drains `pendingMessages` mid-flight)
   *  composes ahead of the caller's `prepareStep`. */
  prepareStep?: PrepareStepFunction

  /** Forwarded to AI SDK onStepFinish. Use for: progress push, otel step span */
  onStepFinish?: (step: StepResult<ToolSet>) => Promise<void> | void

  /** Fires before a tool's `execute` runs. Use for: progress push, otel tool span start. */
  onToolExecutionStart?: (event: ToolExecutionStartEvent) => Promise<void> | void

  /** Fires after `execute` completes (success or error). `durationMs` excludes hook latency. */
  onToolExecutionEnd?: (event: ToolExecutionEndEvent) => Promise<void> | void

  /** After the entire run completes. Use for: analytics, otel root span end.
   *  Aggregating per-run state (token usage, step count, finish reason)
   *  is the caller's responsibility — accumulate it in your own `onStepFinish`
   *  hookPart and read the closure in `onFinish`. */
  onFinish?: () => Promise<void> | void

  /** Error handler. Return 'retry' to retry the run, 'abort' to stop. Default: 'abort'.
   *  Retry is not implemented yet — TODO follow-up. */
  onError?: (ctx: ErrorContext) => Promise<'retry' | 'abort'> | 'retry' | 'abort'
}

// ── Agent options: AI SDK settings forwarded to ToolLoopAgent ──

export interface AgentOptions {
  // CallSettings (model parameters)
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
  /** Tool selection strategy: 'auto' | 'required' | 'none' | { type: 'tool', toolName } */
  toolChoice?: ToolChoice<ToolSet>
  /** Limit which tools are available without changing the type. Dynamic subset of tools. */
  activeTools?: string[]
  /** Provider-specific options (reasoning effort, web search config, etc.) */
  providerOptions?: ProviderOptions
  /** Custom context shared across steps, passed to tool execute functions */
  context?: unknown
  /** Attempt to repair tool calls that fail to parse (wrong args, unknown tool name) */
  repairToolCall?: ToolCallRepairFunction<ToolSet>
  /** Custom download function for URLs when model doesn't support the media type directly */
  download?: DownloadFunction

  // Loop control
  /** Inner loop stop condition. Default: AI SDK default (stepCountIs(20)) */
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  /** AI SDK telemetry — auto-generates otel spans for LLM calls */
  telemetry?: TelemetrySettings
}

// ── Params ──

export interface AgentLoopParams<T extends AppProviderKey = AppProviderKey> {
  providerId: T
  providerSettings: AppProviderSettingsMap[T]
  modelId: string
  /** Optional stable id for the first assistant UIMessage emitted by this execution. */
  messageId?: string
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string
  /** AI SDK agent settings (model params, tool choice, provider options, etc.) */
  options?: AgentOptions
  /**
   * Hook contributors. Each entry is one independent source — features
   * (`RequestFeature.contributeHooks`), the AiService analytics part, etc.
   * Agent folds them with its internal observers via `composeHooks`.
   */
  hookParts?: ReadonlyArray<Partial<AgentLoopHooks>>
  /**
   * Session-isolated queue of follow-up messages injected mid-stream
   * (via `AiStreamManager.injectMessage`).
   *
   * Drained two ways:
   *   1. Mid-flight via `attachSteeringObserver` (registers on `prepareStep`).
   *   2. Tail recheck — after the AI SDK stream settles cleanly, the queue
   *      is checked once more; non-empty triggers another `agent.stream()`
   *      call with the drained messages appended. Catches the race where
   *      the user injects after AI SDK's last `prepareStep` fires.
   *
   * Claude Code provider consumes the queue as `AsyncIterable` directly via
   * `injectedMessageSource`; the steering observer is a no-op for that
   * provider to avoid double-consumption.
   */
  pendingMessages?: PendingMessageQueue
}
