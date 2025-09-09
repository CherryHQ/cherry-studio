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
  sendStepFinishEvent(controller: StreamController, chunk: any): void {
    controller.enqueue({
      type: 'finish-step',
      finishReason: 'stop',
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
    context: AiRequestContext,
    stepId: string
  ): Promise<void> {
    try {
      console.log('[MCP Prompt] Starting recursive call after tool execution...')

      const recursiveResult = await context.recursiveCall(recursiveParams)

      if (recursiveResult && recursiveResult.fullStream) {
        await this.pipeRecursiveStream(controller, recursiveResult.fullStream)
      } else {
        console.warn('[MCP Prompt] No fullstream found in recursive result:', recursiveResult)
      }
    } catch (error) {
      this.handleRecursiveCallError(controller, error, stepId)
    }
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
        if (value.type === 'finish') {
          // 迭代的流不发finish
          break
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
  private handleRecursiveCallError(controller: StreamController, error: unknown, stepId: string): void {
    console.error('[MCP Prompt] Recursive call failed:', error)

    // 使用 AI SDK 标准错误格式，但不中断流
    controller.enqueue({
      type: 'error',
      error: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'RecursiveCallError'
      }
    })

    // 继续发送文本增量，保持流的连续性
    controller.enqueue({
      type: 'text-delta',
      id: stepId,
      text: '\n\n[工具执行后递归调用失败，继续对话...]'
    })
  }

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
}
