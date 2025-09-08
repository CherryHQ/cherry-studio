/**
 * 流事件管理器
 *
 * 负责处理 AI SDK 流事件的发送和管理
 * 从 promptToolUsePlugin.ts 中提取出来以降低复杂度
 */
import type { ModelMessage } from 'ai'

import type { AiRequestContext } from '../../types'
import type { StreamController } from './ToolExecutor'

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
    chunk: any,
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
  async handleRecursiveCall(
    controller: StreamController,
    recursiveParams: any,
    context: AiRequestContext
  ): Promise<void> {
    // try {
    // 重置工具执行状态，准备处理新的步骤
    context.hasExecutedToolsInCurrentStep = false

    const recursiveResult = await context.recursiveCall(recursiveParams)

    if (recursiveResult && recursiveResult.fullStream) {
      await this.pipeRecursiveStream(controller, recursiveResult.fullStream, context)
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
  private async pipeRecursiveStream(
    controller: StreamController,
    recursiveStream: ReadableStream,
    context?: AiRequestContext
  ): Promise<void> {
    const reader = recursiveStream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value.type === 'finish') {
          // 迭代的流不发finish，但需要累加其 usage
          if (value.usage && context?.accumulatedUsage) {
            this.accumulateUsage(context.accumulatedUsage, value.usage)
          }
          break
        }
        // 对于 finish-step 类型，累加其 usage
        if (value.type === 'finish-step' && value.usage && context?.accumulatedUsage) {
          this.accumulateUsage(context.accumulatedUsage, value.usage)
        }
        // 将递归流的数据传递到当前流
        controller.enqueue(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 处理递归调用错误
   */
  // private handleRecursiveCallError(controller: StreamController, error: unknown): void {
  //   console.error('[MCP Prompt] Recursive call failed:', error)

  //   // 使用 AI SDK 标准错误格式，但不中断流
  //   controller.enqueue({
  //     type: 'error',
  //     error: {
  //       message: error instanceof Error ? error.message : String(error),
  //       name: error instanceof Error ? error.name : 'RecursiveCallError'
  //     }
  //   })

  //   // // 继续发送文本增量，保持流的连续性
  //   // controller.enqueue({
  //   //   type: 'text-delta',
  //   //   id: stepId,
  //   //   text: '\n\n[工具执行后递归调用失败，继续对话...]'
  //   // })
  // }

  /**
   * 构建递归调用的参数
   */
  buildRecursiveParams(context: AiRequestContext, textBuffer: string, toolResultsText: string, tools: any): any {
    // 构建新的对话消息
    const newMessages: ModelMessage[] = [
      ...(context.originalParams.messages || []),
      {
        role: 'assistant',
        content: textBuffer
      },
      {
        role: 'user',
        content: toolResultsText
      }
    ]

    // 递归调用，继续对话，重新传递 tools
    const recursiveParams = {
      ...context.originalParams,
      messages: newMessages,
      tools: tools
    }

    // 更新上下文中的消息
    context.originalParams.messages = newMessages

    return recursiveParams
  }

  /**
   * 累加 usage 数据
   */
  private accumulateUsage(target: any, source: any): void {
    if (!target || !source) return

    // 累加各种 token 类型
    target.inputTokens = (target.inputTokens || 0) + (source.inputTokens || 0)
    target.outputTokens = (target.outputTokens || 0) + (source.outputTokens || 0)
    target.totalTokens = (target.totalTokens || 0) + (source.totalTokens || 0)
    target.reasoningTokens = (target.reasoningTokens || 0) + (source.reasoningTokens || 0)
    target.cachedInputTokens = (target.cachedInputTokens || 0) + (source.cachedInputTokens || 0)
  }
}
