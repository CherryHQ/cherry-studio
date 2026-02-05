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
 * 将 MCP 工具调用结果转换为 AI SDK 的 toModelOutput 格式
 *
 * MCP 返回的 content 数组可能包含 { type: "image", data, mimeType } 等多模态内容，
 * 但 AI SDK 的 Google provider 只能通过 toModelOutput 返回
 * { type: "media", data, mediaType } 来生成 inlineData（而非塞进 functionResponse 变成纯文本）。
 *
 * 参考：
 * - AI SDK 文档: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling#multi-modal-tool-results
 * - @ai-sdk/google 源码: convert-to-google-generative-ai-messages.ts 中 case "media" 分支
 * - Gemini CLI issue: https://github.com/google-gemini/gemini-cli/issues/2136
 */
function mcpResultToModelOutput(result: MCPCallToolResponse): { type: 'content'; value: any[] } | undefined {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return undefined
  }

  // 检查是否包含多模态内容（image / audio）
  const hasMultimodal = result.content.some((item) => item.type === 'image' || item.type === 'audio')
  if (!hasMultimodal) {
    return undefined
  }

  const parts: any[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        parts.push({ type: 'text', text: item.text || '' })
        break
      case 'image':
        if (item.data) {
          parts.push({
            type: 'media',
            data: item.data,
            mediaType: item.mimeType || 'image/png'
          })
        } else {
          parts.push({ type: 'text', text: '[Image: no data provided]' })
        }
        break
      case 'audio':
        if (item.data) {
          parts.push({
            type: 'media',
            data: item.data,
            mediaType: item.mimeType || 'audio/mp3'
          })
        } else {
          parts.push({ type: 'text', text: '[Audio: no data provided]' })
        }
        break
      default:
        parts.push({ type: 'text', text: JSON.stringify(item) })
        break
    }
  }

  return { type: 'content', value: parts }
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
      // 将 MCP 多模态结果（image/audio）转为 AI SDK 的 content 格式，
      // 使 @ai-sdk/google 能正确生成 inlineData 而非把 base64 塞进 functionResponse 变成纯文本
      // 注意：AI SDK 直接传 output 值本身（不是 { output: xxx } 包装），参见 ai.js createToolModelOutput
      toModelOutput(rawOutput: unknown) {
        const result = rawOutput as MCPCallToolResponse
        const converted = mcpResultToModelOutput(result)
        if (converted) {
          return converted
        }
        // 无多模态内容时，走默认的 JSON 序列化
        return { type: 'text', value: JSON.stringify(result) }
      }
    })
  }

  return tools
}
