import { definePlugin, StreamTextParams } from '@cherrystudio/ai-core'
import { buildSystemPromptWithTools } from '@renderer/aiCore/transformParameters'
import { buildStreamTextParams } from '@renderer/aiCore/transformParameters'
import { Assistant, MCPTool, MCPToolResponse } from '@renderer/types'
import { parseAndCallTools } from '@renderer/utils/mcp-tools'

/**
 * MCP Prompt 插件配置
 */
export interface MCPPromptPluginConfig {
  mcpTools: MCPTool[]
  assistant: Assistant
  onChunk: (chunk: any) => void
  recursiveCall: (params: StreamTextParams) => Promise<{ stream?: ReadableStream; getText?: () => string }>
  recursionDepth?: number // 当前递归深度，默认为 0
  maxRecursionDepth?: number // 最大递归深度，默认为 20
}

/**
 * 创建 MCP Prompt 模式插件
 * 支持在 prompt 模式下解析文本中的工具调用并执行
 */
export const createMCPPromptPlugin = definePlugin((config: MCPPromptPluginConfig) => {
  return {
    name: 'mcp-prompt-plugin',

    // 1. 参数转换 - 注入工具描述到系统提示
    transformParams: async (params: StreamTextParams) => {
      const { mcpTools, assistant } = config

      if (mcpTools.length === 0) {
        return params
      }

      try {
        // 复用现有的系统提示构建逻辑
        const enhancedSystemPrompt = await buildSystemPromptWithTools(params.system || '', mcpTools, assistant)

        return {
          ...params,
          system: enhancedSystemPrompt,
          // Prompt 模式不使用 function calling
          tools: undefined
        }
      } catch (error) {
        console.error('构建系统提示失败:', error)
        return params
      }
    },

    // 2. 流处理 - 检测工具调用并执行
    transformStream: () => () => {
      let fullResponseText = ''
      let hasProcessedTools = false

      return new TransformStream({
        async transform(chunk, controller) {
          try {
            // 收集完整的文本响应
            if (chunk.type === 'text-delta') {
              fullResponseText += chunk.textDelta
            }

            // 在流结束时检查并处理工具调用
            if (chunk.type === 'finish' && !hasProcessedTools) {
              hasProcessedTools = true

              if (containsToolCallPattern(fullResponseText)) {
                await processToolCallsAndRecurse(fullResponseText, config, controller)
                return // 不转发 finish chunk，让递归调用处理
              }
            }

            // 正常转发其他类型的 chunk
            controller.enqueue(chunk)
          } catch (error) {
            console.error('MCP Prompt Plugin Transform Error:', error)
            controller.error(error)
          }
        },

        async flush(controller) {
          // 流结束时的最后检查
          if (!hasProcessedTools && containsToolCallPattern(fullResponseText)) {
            await processToolCallsAndRecurse(fullResponseText, config, controller)
          }
        }
      })
    }
  }
})

/**
 * 处理工具调用并执行递归
 */
async function processToolCallsAndRecurse(
  responseText: string,
  config: MCPPromptPluginConfig,
  controller: TransformStreamDefaultController
) {
  const { mcpTools, assistant, onChunk, recursionDepth = 0, maxRecursionDepth = 20 } = config

  // 检查是否超过最大递归深度
  if (recursionDepth >= maxRecursionDepth) {
    console.log(`已达到最大递归深度 ${maxRecursionDepth}，停止工具调用处理`)
    controller.enqueue({
      type: 'text-delta',
      textDelta: `\n\n[已达到最大工具调用深度 ${maxRecursionDepth}，停止继续调用]`
    })
    return
  }

  try {
    console.log(`检测到工具调用，开始处理... (递归深度: ${recursionDepth}/${maxRecursionDepth})`)

    const allToolResponses: MCPToolResponse[] = []

    // 直接使用现有的 parseAndCallTools 函数
    // 它会自动解析文本中的工具调用、执行工具、触发 onChunk
    const toolResults = await parseAndCallTools(
      responseText, // 传入完整响应文本，让 parseAndCallTools 自己解析
      allToolResponses,
      onChunk, // 直接传入来自配置的 onChunk
      (mcpToolResponse, resp) => {
        // 复用现有的消息转换逻辑
        return convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp)
      },
      assistant.model!,
      mcpTools
    )

    console.log('工具执行完成，结果数量:', toolResults.length)

    // 如果有工具结果，构建新消息并递归调用
    if (toolResults.length > 0) {
      await performRecursiveCall(responseText, toolResults, config, controller)
    }
  } catch (error) {
    console.error('工具调用处理失败:', error)

    // 发送错误信息作为文本 chunk
    controller.enqueue({
      type: 'text-delta',
      textDelta: `\n\n[工具调用错误: ${error instanceof Error ? error.message : String(error)}]`
    })
  }
}

/**
 * 执行递归调用
 */
async function performRecursiveCall(
  originalResponse: string,
  toolResults: any[],
  config: MCPPromptPluginConfig,
  controller: TransformStreamDefaultController
) {
  const { assistant, recursiveCall, recursionDepth = 0 } = config

  try {
    // 获取当前的消息历史（需要从上下文获取，这里暂时用空数组）
    // TODO: 实现从上下文获取当前消息的逻辑
    const currentMessages = getCurrentMessagesFromContext()

    // 构建新的消息历史
    const newMessages = [
      ...currentMessages,
      {
        role: 'assistant' as const,
        content: originalResponse
      },
      ...toolResults // toolResults 已经是正确的消息格式
    ]

    console.log(`构建新消息历史完成，消息数量: ${newMessages.length}，递归深度: ${recursionDepth}`)

    // 复用现有的参数构建逻辑
    const { params: recursiveParams } = await buildStreamTextParams(newMessages, assistant, {
      mcpTools: config.mcpTools,
      enableTools: true
    })

    console.log(`开始递归调用... (深度: ${recursionDepth + 1})`)

    // 递归调用，递增递归深度
    const recursiveResult = await recursiveCall(recursiveParams)

    // 转发递归结果的流
    if (recursiveResult.stream) {
      const reader = recursiveResult.stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
      } finally {
        reader.releaseLock()
      }
    } else if (recursiveResult.getText) {
      // 如果没有流，但有文本结果
      const finalText = recursiveResult.getText()
      controller.enqueue({
        type: 'text-delta',
        textDelta: finalText
      })
    }

    console.log(`递归调用完成 (深度: ${recursionDepth + 1})`)
  } catch (error) {
    console.error('递归调用失败:', error)

    controller.enqueue({
      type: 'text-delta',
      textDelta: `\n\n[递归调用错误: ${error instanceof Error ? error.message : String(error)}]`
    })
  }
}

/**
 * 检查文本是否包含工具调用模式
 */
function containsToolCallPattern(text: string): boolean {
  const patterns = [
    /<tool_use>/i,
    /<tool_call>/i
    // 可以根据实际使用的格式添加更多模式
  ]

  return patterns.some((pattern) => pattern.test(text))
}

/**
 * 从上下文获取当前消息历史
 * TODO: 实现从实际上下文获取消息的逻辑
 */
function getCurrentMessagesFromContext(): any[] {
  // 这里需要实现从上下文获取当前消息历史的逻辑
  // 暂时返回空数组，后续根据实际情况补充
  console.warn('getCurrentMessagesFromContext 尚未实现，返回空数组')
  return []
}

/**
 * 转换 MCP 工具响应为 SDK 消息参数
 * 复用现有的转换逻辑
 */
function convertMcpToolResponseToSdkMessageParam(mcpToolResponse: MCPToolResponse, resp: any): any {
  // 这里需要根据实际的转换逻辑来实现
  // 暂时返回一个基础的用户消息格式
  return {
    role: 'user',
    content: `工具 ${mcpToolResponse.tool.name} 执行结果: ${JSON.stringify(resp)}`
  }
}

export default createMCPPromptPlugin
