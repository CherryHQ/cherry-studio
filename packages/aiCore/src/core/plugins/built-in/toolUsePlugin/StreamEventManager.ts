/**
 * 流事件管理器
 *
 * 负责处理 AI SDK 流事件的发送和管理
 * 从 promptToolUsePlugin.ts 中提取出来以降低复杂度
 */
import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { EmbeddingModelUsage, ImageModelUsage, LanguageModelUsage, ModelMessage } from 'ai'

import type { AiSdkUsage } from '../../../providers/types'
import type { AiRequestContext, StreamTextParams, StreamTextResult } from '../../types'
import type { StreamController } from './ToolExecutor'

/**
 * 类型守卫：检查对象是否是有效的流结果（包含 ReadableStream 类型的 fullStream）
 */
function hasFullStream(obj: unknown): obj is StreamTextResult & { fullStream: ReadableStream } {
  return typeof obj === 'object' && obj !== null && 'fullStream' in obj && obj.fullStream instanceof ReadableStream
}

/**
 * 类型守卫：检查 usage 是否是 LanguageModelUsage
 * LanguageModelUsage 包含 totalTokens, inputTokens, outputTokens 等字段
 */
function isLanguageModelUsage(usage: unknown): usage is LanguageModelUsage {
  return (
    typeof usage === 'object' &&
    usage !== null &&
    ('totalTokens' in usage || 'inputTokens' in usage || 'outputTokens' in usage)
  )
}

/**
 * 类型守卫：检查 usage 是否是 ImageModelUsage
 * ImageModelUsage 包含 inputTokens, outputTokens, totalTokens 字段
 * but lacks inputTokenDetails/outputTokenDetails which are present in LanguageModelUsage
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
 * 类型守卫：检查 usage 是否是 EmbeddingModelUsage
 * EmbeddingModelUsage 只包含 tokens 字段
 */
function isEmbeddingModelUsage(usage: unknown): usage is EmbeddingModelUsage {
  return (
    typeof usage === 'object' &&
    usage !== null &&
    'tokens' in usage &&
    // 确保只有 tokens 字段（没有 inputTokens, outputTokens 等）
    !('inputTokens' in usage) &&
    !('outputTokens' in usage)
  )
}

/**
 * 流事件管理器类
 */
export class StreamEventManager {
  /**
   * 发送工具调用步骤开始事件
   */
  sendStepStartEvent(controller: StreamController): void {
    controller.enqueue({
      type: 'start-step',
      request: {},
      warnings: []
    })
  }

  /**
   * 发送步骤完成事件
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
    // 累加当前步骤的 usage
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
   * 处理递归调用并将结果流接入当前流
   */
  async handleRecursiveCall<TParams extends StreamTextParams>(
    controller: StreamController,
    recursiveParams: Partial<TParams>,
    context: AiRequestContext<TParams, StreamTextResult>
  ): Promise<void> {
    // try {
    // 重置工具执行状态，准备处理新的步骤
    context.hasExecutedToolsInCurrentStep = false

    const recursiveResult = await context.recursiveCall(recursiveParams)

    if (hasFullStream(recursiveResult)) {
      await this.pipeRecursiveStream(controller, recursiveResult.fullStream)
    } else {
      console.warn('[MCP Prompt] No fullstream found in recursive result:', recursiveResult)
    }
    // } catch (error) {
    //   this.handleRecursiveCallError(controller, error, stepId)
    // }
  }

  /**
   * 将递归流的数据传递到当前流
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
   * 构建递归调用的参数
   */
  buildRecursiveParams<TParams extends StreamTextParams>(
    context: AiRequestContext<TParams, StreamTextResult>,
    textBuffer: string,
    toolResultsText: string,
    tools: Record<string, unknown>
  ): Partial<TParams> {
    const params = context.originalParams

    // 构建新的对话消息
    const newMessages: ModelMessage[] = [
      ...(params.messages || []),
      // 只有当 textBuffer 有内容时才添加 assistant 消息，避免空消息导致 API 错误
      ...(textBuffer ? [{ role: 'assistant' as const, content: textBuffer }] : []),
      {
        role: 'user',
        content: toolResultsText
      }
    ]

    // 递归调用，继续对话，重新传递 tools
    const recursiveParams = {
      ...params,
      messages: newMessages,
      tools: tools
    } as Partial<TParams>

    return recursiveParams
  }

  /**
   * 累加 usage 数据
   *
   * 使用类型守卫来处理不同类型的 usage（LanguageModelUsage, ImageModelUsage, EmbeddingModelUsage）
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

    // ⚠️ 未知类型或类型不匹配，不进行累加
    console.warn('[StreamEventManager] Unable to accumulate usage - type mismatch or unknown type', {
      target,
      source
    })
  }
}
