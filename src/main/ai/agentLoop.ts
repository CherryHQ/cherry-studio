import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { AiPlugin } from '@cherrystudio/ai-core'
import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type {
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

import type { AppProviderSettingsMap } from './types'

const logger = loggerService.withContext('agentLoop')

type AppProviderKey = StringKeys<AppProviderSettingsMap>

// ── Hooks: lifecycle extension points ──

export interface IterationContext {
  iterationNumber: number
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
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string
  /** AI SDK agent settings (model params, tool choice, provider options, etc.) */
  options?: AgentOptions
  hooks?: AgentLoopHooks
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

  ;(async () => {
    // ★ onStart
    await hooks.onStart?.()

    let messages = initialMessages
    let iterationNumber = 0
    let totalSteps = 0
    let totalUsage = ZERO_USAGE
    let lastFinishReason = 'unknown'

    while (!signal.aborted) {
      iterationNumber++

      // ★ beforeIteration (compileContext, memory, otel)
      const beforeResult = await hooks.beforeIteration?.({ iterationNumber, messages, totalSteps })
      if (beforeResult?.messages) messages = beforeResult.messages
      const system = beforeResult?.system ?? params.system

      // ◆ AI SDK: create agent, forward all settings
      const modelMessages = await convertToModelMessages(messages)
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
          // Hooks (forwarded from AgentLoopHooks)
          prepareStep: hooks.prepareStep,
          onStepFinish: hooks.onStepFinish
        }
      })

      const result = await agent.stream({
        messages: modelMessages,
        abortSignal: signal
      })

      // Stream → writer (transport channel)
      const uiStream = result.toUIMessageStream()
      const reader = uiStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || signal.aborted) break
          await writer.write(value)
        }
      } finally {
        reader.releaseLock()
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

      if (!shouldContinue) break
    }

    // ★ onFinish (analytics, otel root span)
    hooks.onFinish?.({ totalUsage, totalIterations: iterationNumber, totalSteps, finishReason: lastFinishReason })
  })()
    .then(() => writer.close())
    .catch(async (err) => {
      if (!signal.aborted) {
        const action = await hooks.onError?.({ iterationNumber: 0, error: err })
        if (action !== 'retry') {
          logger.error('agentLoop error', err)
        }
        // TODO Phase 2: retry logic
      }
      writer.abort(err).catch(() => {})
    })

  return readable
}
