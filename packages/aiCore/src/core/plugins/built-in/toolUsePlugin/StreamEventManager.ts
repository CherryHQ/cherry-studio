/**
 * Stream event manager.
 *
 * Handles AI SDK stream events and recursion flow.
 * Extracted from promptToolUsePlugin.ts to reduce complexity.
 */
import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { EmbeddingModelUsage, ImageModelUsage, LanguageModelUsage, ModelMessage } from 'ai'

import type { AiSdkUsage } from '../../../providers/types'
import type { AiRequestContext, StreamTextParams, StreamTextResult } from '../../types'
import type { BuiltinLoopMessage } from './BuiltinToolStreamManager'
import type { StreamController } from './ToolExecutor'

/**
 * Type guard: checks whether object contains a valid ReadableStream `fullStream`.
 */
function hasFullStream(obj: unknown): obj is StreamTextResult & { fullStream: ReadableStream } {
  return typeof obj === 'object' && obj !== null && 'fullStream' in obj && obj.fullStream instanceof ReadableStream
}

/**
 * Type guard for LanguageModelUsage.
 */
function isLanguageModelUsage(usage: unknown): usage is LanguageModelUsage {
  return (
    typeof usage === 'object' &&
    usage !== null &&
    ('totalTokens' in usage || 'inputTokens' in usage || 'outputTokens' in usage)
  )
}

/**
 * Type guard for ImageModelUsage.
 * It includes input/output/total token fields, but no token detail fields.
 */
function isImageModelUsage(usage: unknown): usage is ImageModelUsage {
  return (
    typeof usage === 'object' &&
    usage !== null &&
    'inputTokens' in usage &&
    'outputTokens' in usage &&
    !('inputTokenDetails' in usage) &&
    !('outputTokenDetails' in usage)
  )
}

/**
 * Type guard for EmbeddingModelUsage.
 */
function isEmbeddingModelUsage(usage: unknown): usage is EmbeddingModelUsage {
  return (
    typeof usage === 'object' &&
    usage !== null &&
    'tokens' in usage &&
    // Ensure only embedding usage shape is accepted.
    !('inputTokens' in usage) &&
    !('outputTokens' in usage)
  )
}

/**
 * Stream event manager class.
 */
export class StreamEventManager {
  /**
   * Emits start-step event.
   */
  sendStepStartEvent(controller: StreamController): void {
    controller.enqueue({
      type: 'start-step',
      request: {},
      warnings: []
    })
  }

  /**
   * Emits finish-step event.
   */
  sendStepFinishEvent(
    controller: StreamController,
    chunk: {
      usage?: Partial<AiSdkUsage>
      response?: { id: string; [key: string]: unknown }
      providerMetadata?: SharedV3ProviderMetadata
    },
    context: AiRequestContext,
    finishReason: string = 'stop'
  ): void {
    // Accumulate usage for this step.
    if (chunk.usage && context.accumulatedUsage) {
      this.accumulateUsage(context.accumulatedUsage, chunk.usage)
    }

    controller.enqueue({
      type: 'finish-step',
      finishReason,
      response: chunk.response,
      usage: chunk.usage,
      providerMetadata: chunk.providerMetadata
    })
  }

  /**
   * Executes recursive call and pipes recursive stream into current controller.
   */
  async handleRecursiveCall<TParams extends StreamTextParams>(
    controller: StreamController,
    recursiveParams: Partial<TParams>,
    context: AiRequestContext<TParams, StreamTextResult>
  ): Promise<void> {
    // try {
    // Reset tool execution state before processing next step.
    context.hasExecutedToolsInCurrentStep = false

    const recursiveResult = await context.recursiveCall(recursiveParams)

    if (hasFullStream(recursiveResult)) {
      await this.pipeRecursiveStream(controller, recursiveResult.fullStream)
    } else {
      this.logWithContext(context, 'warn', '[MCP Prompt] No fullstream found in recursive result', {
        recursiveResult
      })
    }
    // } catch (error) {
    //   this.handleRecursiveCallError(controller, error, stepId)
    // }
  }

  /**
   * Pipes recursive stream chunks to current stream.
   */
  private async pipeRecursiveStream(controller: StreamController, recursiveStream: ReadableStream): Promise<void> {
    const reader = recursiveStream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value.type === 'start') {
          continue
        }

        if (value.type === 'finish') {
          break
        }

        controller.enqueue(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Builds recursive params for plain tool-result continuation.
   */
  buildRecursiveParams<TParams extends StreamTextParams>(
    context: AiRequestContext<TParams, StreamTextResult>,
    textBuffer: string,
    toolResultsText: string,
    tools: Record<string, unknown>
  ): Partial<TParams> {
    const params = context.originalParams

    // Build the new message chain.
    const newMessages: ModelMessage[] = [
      ...(params.messages || []),
      // Add assistant message only when text exists to avoid empty-message API errors.
      ...(textBuffer ? [{ role: 'assistant' as const, content: textBuffer }] : []),
      {
        role: 'user',
        content: toolResultsText
      }
    ]

    // Continue conversation and pass tools forward.
    const recursiveParams = {
      ...params,
      messages: newMessages,
      tools: tools
    } as Partial<TParams>

    return recursiveParams
  }

  /**
   * Builds recursive params with prebuilt messages for provider built-in tools
   * (for example Moonshot `$web_search`).
   */
  buildRecursiveParamsWithMessages<TParams extends StreamTextParams>(
    context: AiRequestContext<TParams, StreamTextResult>,
    messages: BuiltinLoopMessage[],
    tools: Record<string, unknown>
  ): Partial<TParams> {
    const params = context.originalParams

    // Reuse the full message chain prepared by builtin tool manager.
    const recursiveParams = {
      ...params,
      messages: [...(params.messages || []), ...messages],
      tools: tools
    } as Partial<TParams>

    return recursiveParams
  }

  /**
   * Accumulates usage data.
   *
   * Handles different usage variants via type guards.
   * - LanguageModelUsage: inputTokens, outputTokens, totalTokens
   * - ImageModelUsage: inputTokens, outputTokens, totalTokens
   * - EmbeddingModelUsage: tokens
   */
  accumulateUsage(target: Partial<AiSdkUsage>, source: Partial<AiSdkUsage>): void {
    if (!target || !source) return

    if (isLanguageModelUsage(target) && isLanguageModelUsage(source)) {
      target.totalTokens = (target.totalTokens || 0) + (source.totalTokens || 0)
      target.inputTokens = (target.inputTokens || 0) + (source.inputTokens || 0)
      target.outputTokens = (target.outputTokens || 0) + (source.outputTokens || 0)

      // Accumulate inputTokenDetails (cacheReadTokens, cacheWriteTokens, noCacheTokens)
      if (source.inputTokenDetails) {
        if (!target.inputTokenDetails) {
          target.inputTokenDetails = {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined
          }
        }
        target.inputTokenDetails.cacheReadTokens =
          (target.inputTokenDetails.cacheReadTokens || 0) + (source.inputTokenDetails.cacheReadTokens || 0)
        target.inputTokenDetails.cacheWriteTokens =
          (target.inputTokenDetails.cacheWriteTokens || 0) + (source.inputTokenDetails.cacheWriteTokens || 0)
        target.inputTokenDetails.noCacheTokens =
          (target.inputTokenDetails.noCacheTokens || 0) + (source.inputTokenDetails.noCacheTokens || 0)
      }

      // Accumulate outputTokenDetails (reasoningTokens, textTokens)
      if (source.outputTokenDetails) {
        if (!target.outputTokenDetails) {
          target.outputTokenDetails = { textTokens: undefined, reasoningTokens: undefined }
        }
        target.outputTokenDetails.reasoningTokens =
          (target.outputTokenDetails.reasoningTokens || 0) + (source.outputTokenDetails.reasoningTokens || 0)
        target.outputTokenDetails.textTokens =
          (target.outputTokenDetails.textTokens || 0) + (source.outputTokenDetails.textTokens || 0)
      }
      return
    }
    if (isImageModelUsage(target) && isImageModelUsage(source)) {
      target.totalTokens = (target.totalTokens || 0) + (source.totalTokens || 0)
      target.inputTokens = (target.inputTokens || 0) + (source.inputTokens || 0)
      target.outputTokens = (target.outputTokens || 0) + (source.outputTokens || 0)
      return
    }

    if (isEmbeddingModelUsage(target) && isEmbeddingModelUsage(source)) {
      target.tokens = (target.tokens || 0) + (source.tokens || 0)
      return
    }

    // Unknown usage type or mismatched usage shape; skip accumulation.
    console.warn('[StreamEventManager] Unable to accumulate usage - type mismatch or unknown type', {
      target,
      source
    })
  }

  private logWithContext(
    context: AiRequestContext,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (typeof context.logger === 'function') {
      context.logger(level, message, data)
      return
    }

    if (level === 'warn') {
      if (data) {
        console.warn(message, data)
      } else {
        console.warn(message)
      }
    }
  }
}
