/**
 * 内置工具流管理器
 * 处理 Provider 内置工具（如 Moonshot 的 $web_search）的流事件
 */
import type { AiRequestContext } from '../../'

/**
 * 工具调用结果
 */
export interface BuiltinToolCall {
  id: string
  name: string
  arguments: any
  rawArguments?: string
  toolType?: string
}

/**
 * 内置工具流管理器
 */
export class BuiltinToolStreamManager {
  /**
   * 检查是否为内置工具调用
   */
  isBuiltinToolCall(toolName: string, context: AiRequestContext): boolean {
    return context.builtinTools?.[toolName]?.isBuiltin ?? false
  }

  /**
   * 从 chunk 中提取工具调用信息
   */
  extractToolCallsFromChunk(chunk: any): BuiltinToolCall[] {
    const toolCalls = chunk.toolCalls || chunk.tool_calls
    if (!toolCalls) return []

    return toolCalls.map((tc: any) => {
      const rawArguments = typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined
      let parsedArguments = tc.arguments || {}

      if (rawArguments) {
        try {
          parsedArguments = JSON.parse(rawArguments)
        } catch {
          parsedArguments = rawArguments
        }
      }

      return {
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments: parsedArguments,
        rawArguments,
        toolType: tc.type
      }
    })
  }

  /**
   * 处理 finish_step 事件，检查是否需要工具调用循环
   * @returns shouldContinue - 是否需要继续递归调用
   * @returns updatedMessages - 更新的消息数组（包含 tool results）
   */
  async handleFinishStepWithBuiltinTools(
    chunk: any,
    context: AiRequestContext
  ): Promise<{ shouldContinue: boolean; updatedMessages?: any[] }> {
    const { builtinTools } = context

    if (!builtinTools || Object.keys(builtinTools).length === 0) {
      return { shouldContinue: false }
    }

    // 检查 finish_reason 是否为 tool_calls
    if (chunk.finishReason !== 'tool_calls') {
      return { shouldContinue: false }
    }

    const toolCalls = this.extractToolCallsFromChunk(chunk)
    if (toolCalls.length === 0) {
      return { shouldContinue: false }
    }

    // 检查是否所有工具调用都是内置工具
    const builtinToolResults: Array<{ tool_call_id: string; role: 'tool'; content: string; name: string }> = []
    let hasBuiltinTools = false

    for (const toolCall of toolCalls) {
      if (this.isBuiltinToolCall(toolCall.name, context)) {
        hasBuiltinTools = true
        // 内置工具不需要本地执行，直接构造结果
        builtinToolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.name,
          content: toolCall.rawArguments ?? JSON.stringify(toolCall.arguments ?? {})
        })
      }
    }

    if (hasBuiltinTools && builtinToolResults.length > 0) {
      return {
        shouldContinue: true,
        updatedMessages: [
          // 添加 assistant 消息（包含 tool_calls）
          {
            role: 'assistant',
            content: chunk.content || '',
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type:
                tc.toolType ||
                context.builtinTools?.[tc.name]?.definition?.type ||
                context.builtinTools?.[tc.name]?.toolType ||
                'function',
              function: {
                name: tc.name,
                arguments: tc.rawArguments ?? JSON.stringify(tc.arguments ?? {})
              }
            }))
          },
          // 添加 tool 结果消息
          ...builtinToolResults
        ]
      }
    }

    return { shouldContinue: false }
  }

  /**
   * 检查 chunk 是否包含内置工具调用
   */
  hasBuiltinToolCalls(chunk: any, context: AiRequestContext): boolean {
    const toolCalls = this.extractToolCallsFromChunk(chunk)
    if (toolCalls.length === 0) return false

    return toolCalls.some((tc) => this.isBuiltinToolCall(tc.name, context))
  }
}
