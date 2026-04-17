import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { AiPlugin } from '@cherrystudio/ai-core'
import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type {
  Experimental_DownloadFunction as DownloadFunction,
  LanguageModelUsage,
  ModelMessage,
  PrepareStepFunction,
  StepResult,
  StopCondition,
  TelemetrySettings,
  ToolCallRepairFunction,
  ToolChoice,
  ToolSet,
  UIMessage,
  UIMessageChunk
} from 'ai'
import { convertToModelMessages } from 'ai'

import type { PendingMessageQueue } from './PendingMessageQueue'
import type { AppProviderSettingsMap } from './types'

const logger = loggerService.withContext('agentLoop')

type AppProviderKey = StringKeys<AppProviderSettingsMap>

// ── Hooks: lifecycle extension points ──

export interface IterationContext {
  iterationNumber: number
  /**
   * Conversation view as UIMessage[] — grows each iteration with an empty
   * assistant placeholder + any steering user messages drained between
   * iterations. Hooks that need the actual assistant response content should
   * consult `IterationResult.messages` inside `afterIteration`.
   */
  messages: UIMessage[]
  totalSteps: number
}

export interface BeforeIterationResult {
  /** Replace messages for this iteration (e.g. compileContext output) */
  messages?: UIMessage[]
  /** Replace system prompt (e.g. memory injection) */
  system?: string
}

export interface IterationResult {
  /** Assistant response messages for persistence */
  messages: ModelMessage[]
  /** Token usage for this iteration */
  usage: LanguageModelUsage
  /** Why the last step ended: 'stop' | 'tool-calls' | 'length' | 'error' | ... */
  finishReason: string
  /** All steps in this iteration (tool calls, results, per-step usage) */
  steps: StepResult<ToolSet>[]
  /** Provider response metadata */
  response: {
    id: string
    modelId: string
    timestamp: Date
  }
  /** Web search sources referenced */
  sources: unknown[]
}

export interface LoopFinishResult {
  totalUsage: LanguageModelUsage
  totalIterations: number
  totalSteps: number
  /** Finish reason from the last iteration */
  finishReason: string
}

export interface ErrorContext {
  iterationNumber: number
  error: Error
}

export interface AgentLoopHooks {
  /** Before the loop starts. Use for: otel root span, load memory */
  onStart?: () => Promise<void> | void

  /** Before each outer loop iteration. Use for: compileContext, memory recall, otel iteration span */
  beforeIteration?: (ctx: IterationContext) => Promise<BeforeIterationResult | void> | BeforeIterationResult | void

  /** Forwarded to AI SDK prepareStep. Use for: steering drain, tail pruning */
  prepareStep?: PrepareStepFunction

  /** Forwarded to AI SDK onStepFinish. Use for: progress push, otel step span */
  onStepFinish?: (step: StepResult<ToolSet>) => void

  /** After each outer loop iteration. Use for: persist, memory update, SWR invalidate.
   *  Return true to continue outer loop (restart with pending messages). */
  afterIteration?: (ctx: IterationContext, result: IterationResult) => Promise<boolean | void> | boolean | void

  /** After entire loop completes. Use for: analytics, otel root span end */
  onFinish?: (result: LoopFinishResult) => void

  /** Error handler. Return 'retry' to retry current iteration, 'abort' to stop. Default: 'abort' */
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
  hooks?: AgentLoopHooks
  /** Session-isolated steering queue. Drained between iterations to append user messages. */
  pendingMessages?: PendingMessageQueue
}

// ── Runner ──

function mergeUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
    inputTokenDetails: b.inputTokenDetails ?? a.inputTokenDetails,
    outputTokenDetails: b.outputTokenDetails ?? a.outputTokenDetails
  }
}

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }
}

export function runAgentLoop<T extends AppProviderKey>(
  params: AgentLoopParams<T>,
  initialMessages: UIMessage[],
  signal: AbortSignal
): ReadableStream<UIMessageChunk> {
  const { readable, writable } = new TransformStream<UIMessageChunk>()
  const writer = writable.getWriter()
  const hooks = params.hooks ?? {}
  const opts = params.options ?? {}

  // Shared between the loop body and the terminal `.catch`, so a mid-loop
  // throw can report the real iteration number to hooks.onError.
  let iterationNumber = 0

  ;(async () => {
    // ★ onStart
    await hooks.onStart?.()

    // Single track: all message state is ModelMessage[] throughout the loop.
    // Converted once at entry, then directly appended (no lossy round-trips).
    let messages = initialMessages
    let modelMessages = await convertToModelMessages(initialMessages)
    let totalSteps = 0
    let totalUsage = ZERO_USAGE
    let lastFinishReason = 'unknown'
    let hasUsedProvidedMessageId = false

    while (!signal.aborted) {
      iterationNumber++

      // ★ beforeIteration (compileContext, memory, otel)
      const beforeResult = await hooks.beforeIteration?.({ iterationNumber, messages, totalSteps })
      if (beforeResult?.messages) {
        messages = beforeResult.messages
        modelMessages = await convertToModelMessages(messages)
      }
      const system = beforeResult?.system ?? params.system

      // ◆ AI SDK: create agent, forward all settings
      const agent = await createAgent<AppProviderSettingsMap, T, ToolSet>({
        providerId: params.providerId,
        providerSettings: params.providerSettings,
        modelId: params.modelId,
        plugins: params.plugins,
        agentSettings: {
          // Tools
          tools: params.tools as ToolSet,
          toolChoice: opts.toolChoice,
          activeTools: opts.activeTools as Array<keyof ToolSet>,
          // System
          instructions: system,
          // CallSettings (model parameters)
          maxOutputTokens: opts.maxOutputTokens,
          temperature: opts.temperature,
          topP: opts.topP,
          topK: opts.topK,
          presencePenalty: opts.presencePenalty,
          frequencyPenalty: opts.frequencyPenalty,
          stopSequences: opts.stopSequences,
          seed: opts.seed,
          maxRetries: opts.maxRetries,
          timeout: opts.timeout,
          headers: opts.headers,
          // Provider-specific
          providerOptions: opts.providerOptions,
          // Loop control
          stopWhen: opts.stopWhen,
          // Experimental
          experimental_telemetry: opts.telemetry,
          experimental_context: opts.context,
          experimental_repairToolCall: opts.repairToolCall,
          experimental_download: opts.download,
          // Hooks (forwarded from AgentLoopHooks)
          prepareStep: hooks.prepareStep,
          onStepFinish: hooks.onStepFinish
        }
      })

      const result = await agent.stream({
        messages: modelMessages,
        abortSignal: signal
      })

      let capturedStreamError: unknown

      // Stream → writer (transport channel)
      //
      // `messageMetadata` is the single AI SDK hook that injects usage /
      // finish info into the emitted UIMessage. Without it, consumers of
      // `readUIMessageStream` (including Cherry's PersistenceBackend) see
      // `UIMessage.metadata === undefined` and cannot populate `stats`.
      //
      // We project AI SDK v5 usage names onto the legacy Cherry names used
      // by `MessageStats` / `CherryUIMessageMetadata`:
      //   inputTokens                         → promptTokens
      //   outputTokens                        → completionTokens
      //   totalTokens                         → totalTokens
      //   outputTokenDetails.reasoningTokens  → thoughtsTokens
      //
      // We emit on the `finish` boundary so the captured usage reflects
      // the iteration's final tally; multi-iteration loops overwrite
      // with the last iteration's totals (sufficient for single-turn
      // persistence today — full cross-iteration aggregation and the
      // cache / modality breakdown are tracked in `MessageStats`'s
      // redesign TODO).
      //
      // TODO(stream-stats-followup): Two gaps remain for `MessageStats`.
      //
      // 1. Usage on error/abort paths
      //    This callback only fires on `finish` chunks. When the stream
      //    fails mid-flight the AI SDK emits `error` or `abort` chunks
      //    instead — neither carries usage, so nothing lands in
      //    UIMessage.metadata even when the provider has already billed
      //    the prompt tokens. Fix: in the per-iteration `finally` below,
      //    salvage `result.totalUsage` (with a `.catch(() => undefined)`
      //    guard + signal-aware timeout) and inject it as a
      //    `{ type: 'message-metadata' }` UIMessageChunk on the writer.
      //    `readUIMessageStream` merges that chunk into the accumulated
      //    message, giving us usage even on the error/abort paths.
      //
      // 2. `timeThinkingMs` — pure reasoning vs tool-exec time
      //    `ExecutionTimings.reasoningStartedAt / reasoningEndedAt` (set
      //    by the pump) is wall-clock and may include tool execution
      //    time that interleaves reasoning and text chunks. We currently
      //    DO NOT project it onto `MessageStats.timeThinkingMs` to avoid
      //    a polluted value in the DB.
      //
      //    Precise separation path: expose `onToolCallStart` /
      //    `onToolCallFinish` on `AgentLoopHooks` (AI SDK `agentSettings`
      //    already supports them — see `OnToolCallFinishEvent.durationMs`
      //    for the native tool-execution measurement). AiService's
      //    `composeHooks` attaches an internal hook that accumulates
      //    `durationMs` for tool calls whose start timestamp falls inside
      //    `[reasoningStartedAt, reasoningEndedAt]`, writing the sum back
      //    onto `exec.timings.toolMsDuringReasoning`. `statsFromTerminal`
      //    then computes
      //    `timeThinkingMs = (reasoningEnded - reasoningStarted) - toolMsDuringReasoning`.
      //
      //    Alternative path: enable AI SDK `experimental_telemetry` and
      //    read `ai.response.msToFirstChunk` / per-tool span durations
      //    from the OTEL trace (Cherry's `packages/mcp-trace/` is the
      //    existing OTEL receiver). That sidesteps manual accumulation.
      const uiStream = result.toUIMessageStream({
        generateMessageId: () => {
          if (!hasUsedProvidedMessageId && params.messageId) {
            hasUsedProvidedMessageId = true
            return params.messageId
          }
          return crypto.randomUUID()
        },
        messageMetadata: ({ part }) => {
          if (part.type !== 'finish') return undefined
          const usage = part.totalUsage
          if (!usage) return undefined
          return {
            totalTokens: usage.totalTokens,
            promptTokens: usage.inputTokens,
            completionTokens: usage.outputTokens,
            thoughtsTokens: usage.outputTokenDetails?.reasoningTokens
          }
        },
        onError: (error) => {
          capturedStreamError ??= error
          return error instanceof Error ? error.message : String(error)
        }
      })
      const reader = uiStream.getReader()
      let readError: unknown
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || signal.aborted) break
          await writer.write(value)
        }
      } catch (error) {
        readError = error
      } finally {
        reader.releaseLock()
      }

      if (capturedStreamError) {
        throw capturedStreamError
      }

      if (readError) {
        throw readError
      }

      // ◆ AI SDK: resolve all promised fields after stream ends
      const [iterationUsage, steps, finishReason, response, sources] = await Promise.all([
        result.totalUsage,
        result.steps,
        result.finishReason,
        result.response,
        result.sources
      ])
      totalUsage = mergeUsage(totalUsage, iterationUsage)
      totalSteps += steps.length
      lastFinishReason = finishReason

      // ★ afterIteration (persist, memory, SWR invalidate)
      const shouldContinue = await hooks.afterIteration?.(
        { iterationNumber, messages, totalSteps },
        {
          messages: response.messages,
          usage: iterationUsage,
          finishReason,
          steps,
          response: { id: response.id, modelId: response.modelId, timestamp: response.timestamp },
          sources
        }
      )

      // Continue if afterIteration explicitly returns true
      if (shouldContinue === true) continue

      // Before breaking, drain pending steering messages into the conversation
      const pending = params.pendingMessages?.drain() ?? []
      if (pending.length === 0) break

      // Append: assistant response + pending user messages → next iteration
      const pendingAsUI: UIMessage[] = pending.map((msg) => ({
        id: msg.id,
        role: 'user' as const,
        parts: msg.data?.parts ?? []
      }))

      // Mirror the iteration's growth onto `messages` so next iteration's
      // `hooks.beforeIteration({ messages, … })` sees an up-to-date
      // conversation view. We use `response.id` for the assistant turn and
      // leave `parts` empty — hooks that need the assistant response should
      // consult `IterationResult.messages` (ModelMessage[]) inside
      // `afterIteration`; `ctx.messages` is a conversation-shape context,
      // not a transcript.
      const assistantPlaceholderUI: UIMessage = {
        id: response.id,
        role: 'assistant',
        parts: []
      }
      messages = [...messages, assistantPlaceholderUI, ...pendingAsUI]
      modelMessages = [...modelMessages, ...response.messages, ...(await convertToModelMessages(pendingAsUI))]
    }

    // ★ onFinish (analytics, otel root span)
    params.pendingMessages?.close()
    hooks.onFinish?.({ totalUsage, totalIterations: iterationNumber, totalSteps, finishReason: lastFinishReason })
  })()
    .then(() => {
      params.pendingMessages?.close()
      return writer.close()
    })
    .catch(async (err) => {
      params.pendingMessages?.close()
      if (!signal.aborted) {
        const action = await hooks.onError?.({ iterationNumber, error: err })
        if (action !== 'retry') {
          logger.error('agentLoop error', err)
        }
        // TODO Phase 2: retry logic
      }
      writer.abort(err).catch(() => {})
    })

  return readable
}
