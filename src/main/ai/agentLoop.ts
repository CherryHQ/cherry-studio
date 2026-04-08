import type { AiPlugin } from '@cherrystudio/ai-core'
import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type {
  LanguageModelUsage,
  ModelMessage,
  PrepareStepFunction,
  StepResult,
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
  messages: ModelMessage[]
  usage: LanguageModelUsage
}

export interface LoopFinishResult {
  totalUsage: LanguageModelUsage
  totalIterations: number
  totalSteps: number
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

// ── Params ──

export interface AgentLoopParams<T extends AppProviderKey = AppProviderKey> {
  providerId: T
  providerSettings: AppProviderSettingsMap[T]
  modelId: string
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string
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

  ;(async () => {
    // ★ onStart
    await hooks.onStart?.()

    let messages = initialMessages
    let iterationNumber = 0
    let totalSteps = 0
    let totalUsage = ZERO_USAGE

    while (!signal.aborted) {
      iterationNumber++

      // ★ beforeIteration (compileContext, memory, otel)
      const beforeResult = await hooks.beforeIteration?.({ iterationNumber, messages, totalSteps })
      if (beforeResult?.messages) messages = beforeResult.messages
      const system = beforeResult?.system ?? params.system

      // ◆ AI SDK: create agent, forward hooks to agentSettings
      const modelMessages = await convertToModelMessages(messages)
      const agent = await createAgent<AppProviderSettingsMap, T>({
        providerId: params.providerId,
        providerSettings: params.providerSettings,
        modelId: params.modelId,
        plugins: params.plugins,
        agentSettings: {
          tools: params.tools as ToolSet,
          instructions: system,

          prepareStep: hooks.prepareStep as any,
          onStepFinish: hooks.onStepFinish as any
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

      // ◆ AI SDK: totalUsage resolves after stream ends
      const iterationUsage = await result.totalUsage
      totalUsage = mergeUsage(totalUsage, iterationUsage)
      const steps = await result.steps
      totalSteps += steps.length

      // ★ afterIteration (persist, memory, SWR invalidate)
      const shouldContinue = await hooks.afterIteration?.(
        { iterationNumber, messages, totalSteps },
        { messages: (await result.response).messages, usage: iterationUsage }
      )

      if (!shouldContinue) break
    }

    // ★ onFinish (analytics, otel root span)
    hooks.onFinish?.({ totalUsage, totalIterations: iterationNumber, totalSteps })
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
