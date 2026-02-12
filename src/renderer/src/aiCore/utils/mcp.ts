import { loggerService } from '@logger'
import type { MCPCallToolResponse, MCPTool, MCPToolResponse } from '@renderer/types'
import { callMCPTool, getMcpServerByTool, isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { requestToolConfirmation } from '@renderer/utils/userConfirmation'
import { type Tool, type ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7 } from 'json-schema'

const logger = loggerService.withContext('MCP-utils')

// Setup tools configuration based on provided parameters
export function setupToolsConfig(mcpTools?: MCPTool[]): Record<string, Tool<any, any>> | undefined {
  let tools: ToolSet = {}

  if (!mcpTools?.length) {
    return undefined
  }

  tools = convertMcpToolsToAiSdkTools(mcpTools)

  return tools
}

/**
 * 检查 MCP 工具调用结果是否包含多模态内容（image / audio）
 */
function hasMultimodalContent(result: MCPCallToolResponse): boolean {
  return Array.isArray(result?.content) && result.content.some((item) => item.type === 'image' || item.type === 'audio')
}

/**
 * 将 MCP 工具调用结果转换为纯文本摘要（用于不支持多模态 tool result 的 provider）
 *
 * OpenAI 兼容格式的 tool 消息 content 只能是字符串。
 * 如果把 base64 图片塞进去，会导致消息大小超限（如 kimi 的 4MB 限制）。
 * 这里把图片/音频替换为文本占位描述。
 */
function mcpResultToTextSummary(result: MCPCallToolResponse): string {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return JSON.stringify(result)
  }

  const parts: string[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        parts.push(item.text || '')
        break
      case 'image':
        parts.push(`[Image: ${item.mimeType || 'image/png'}, delivered to user]`)
        break
      case 'audio':
        parts.push(`[Audio: ${item.mimeType || 'audio/mp3'}, delivered to user]`)
        break
      default:
        parts.push(JSON.stringify(item))
        break
    }
  }

  return parts.join('\n')
}

/**
 * 将 MCPTool 转换为 AI SDK 工具格式
 */
export function convertMcpToolsToAiSdkTools(mcpTools: MCPTool[]): ToolSet {
  const tools: ToolSet = {}

  for (const mcpTool of mcpTools) {
    // Use mcpTool.id (which includes serverId suffix) to ensure uniqueness
    // when multiple instances of the same MCP server type are configured
    tools[mcpTool.id] = tool({
      description: mcpTool.description || `Tool from ${mcpTool.serverName}`,
      inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
      execute: async (params, { toolCallId }) => {
        // 检查是否启用自动批准
        const server = getMcpServerByTool(mcpTool)
        const isAutoApproveEnabled = isToolAutoApproved(mcpTool, server)

        let confirmed = true

        if (!isAutoApproveEnabled) {
          // 请求用户确认
          logger.debug(`Requesting user confirmation for tool: ${mcpTool.name}`)
          confirmed = await requestToolConfirmation(toolCallId)
        }

        if (!confirmed) {
          // 用户拒绝执行工具
          logger.debug(`User cancelled tool execution: ${mcpTool.name}`)
          return {
            content: [
              {
                type: 'text',
                text: `User declined to execute tool "${mcpTool.name}".`
              }
            ],
            isError: false
          }
        }

        // 用户确认或自动批准，执行工具
        logger.debug(`Executing tool: ${mcpTool.name}`)

        // 创建适配的 MCPToolResponse 对象
        const toolResponse: MCPToolResponse = {
          id: toolCallId,
          tool: mcpTool,
          arguments: params,
          status: 'pending',
          toolCallId
        }

        const result = await callMCPTool(toolResponse)

        // 返回结果，AI SDK 会处理序列化
        if (result.isError) {
          return Promise.reject(result)
        }
        // 返回工具执行结果
        return result
      },
      // 将 MCP 多模态结果（image/audio）转为文本摘要，避免 base64 超出消息大小限制
      //
      // 图片/音频已通过 IMAGE_COMPLETE chunk 展示给用户（UI 路径独立），
      // 模型端只需知道"工具返回了图片/音频"即可。
      // 所有 provider 统一使用 text summary，安全兼容（OpenAI 兼容格式不支持 media）。
      //
      // TODO: 等 AI SDK 提供 provider 感知能力后，可以按 provider 分别处理
      // （如 Gemini 可返回 content + media 格式让模型"看见"图片）
      //
      // 注意：AI SDK 直接传 output 值本身（不是 { output: xxx } 包装），参见 ai.js createToolModelOutput
      toModelOutput(rawOutput: unknown) {
        // rawOutput 来自上方 execute 的 return result，类型始终为 MCPCallToolResponse
        // mcpResultToTextSummary 内部已有 null/content 校验，不会因意外输入崩溃
        const result = rawOutput as MCPCallToolResponse

        if (hasMultimodalContent(result)) {
          return { type: 'text' as const, value: mcpResultToTextSummary(result) }
        }

        // 无多模态内容时，走默认的 JSON 序列化
        return { type: 'text' as const, value: JSON.stringify(result) }
      }
    })
  }

  return tools
}
