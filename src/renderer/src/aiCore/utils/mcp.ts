import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import { loggerService } from '@logger'
import type { MCPCallToolResponse, MCPTool, MCPToolResponse } from '@renderer/types'
import { callMCPTool, getMcpServerByTool, isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { requestToolConfirmation } from '@renderer/utils/userConfirmation'
import { type Tool, type ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7 } from 'json-schema'

type ToolResultContentOutput = Extract<LanguageModelV2ToolResultOutput, { type: 'content' }>
type ToolResultContentPart = ToolResultContentOutput['value'][number]

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
 * MCP 返回的 content 数组可能包含 { type: "image", data, mimeType } 等多模态内容。
 *
 * 不同的 AI SDK provider 对 tool result 的处理方式不同：
 * - @ai-sdk/google: output.type === "content" 时，遍历 value，"media" → inlineData（模型能看图片）
 * - @ai-sdk/openai-compatible: output.type === "content" 时，JSON.stringify(value) → 纯字符串
 *   OpenAI tool 消息的 content 只能是字符串，不支持图片，且大图 base64 会超出消息大小限制
 *
 * 策略：
 * - 图片/音频通过 IMAGE_COMPLETE chunk 已经展示给了用户（UI 路径独立）
 * - 对于 Gemini：返回 { type: "content", value: [{ type: "media", ... }] }，让模型能"看见"图片
 * - 对于 OpenAI 兼容格式：返回纯文本描述，避免 8MB base64 被 JSON.stringify 后超出限制
 *
 * 由于 toModelOutput 无法感知当前 provider，这里统一返回 content 格式（Gemini 受益），
 * 同时为 media 部分提供文本占位，确保 JSON.stringify 后不会产生巨大字符串。
 *
 * 参考：
 * - AI SDK 文档: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling#multi-modal-tool-results
 * - @ai-sdk/google 源码: convert-to-google-generative-ai-messages.ts 中 case "media" 分支
 * - Gemini CLI issue: https://github.com/google-gemini/gemini-cli/issues/2136
 */
function mcpResultToModelOutput(result: MCPCallToolResponse): ToolResultContentOutput | undefined {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return undefined
  }

  // 检查是否包含多模态内容（image / audio）
  const hasMultimodal = result.content.some((item) => item.type === 'image' || item.type === 'audio')
  if (!hasMultimodal) {
    return undefined
  }

  const parts: ToolResultContentPart[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        parts.push({ type: 'text', text: item.text || '' })
        break
      case 'image':
        if (item.data) {
          // Gemini: @ai-sdk/google 会将 media 转为 inlineData
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
      // 将 MCP 多模态结果（image/audio）转为 AI SDK 可理解的格式
      //
      // @ai-sdk/google (Gemini): "content" + "media" → inlineData，模型能看见图片
      // @ai-sdk/openai-compatible: "content" → JSON.stringify(value)，大图 base64 会超限
      //
      // 策略：优先尝试 content 格式（Gemini 受益），如果不含多模态则返回纯文本摘要
      // 对于 OpenAI 兼容 provider，JSON.stringify media 虽然不理想但图片数据已通过
      // IMAGE_COMPLETE 展示给用户，模型端只需知道"工具返回了图片"即可
      //
      // 注意：AI SDK 直接传 output 值本身（不是 { output: xxx } 包装），参见 ai.js createToolModelOutput
      toModelOutput(rawOutput: unknown) {
        const result = rawOutput as MCPCallToolResponse

        // 尝试转为 content 格式（Gemini 能正确处理 media → inlineData）
        const converted = mcpResultToModelOutput(result)
        if (converted) {
          // 检查 content 中是否有 media 部分
          // 如果有，同时提供纯文本摘要作为 fallback
          // @ai-sdk/openai-compatible 会 JSON.stringify content.value，
          // 其中 media 的 data 字段会被序列化为巨大字符串
          // 为避免超限，返回纯文本摘要（对 Gemini 不够理想但安全）
          //
          // TODO: 等 AI SDK 提供 provider 感知能力后，可以按 provider 分别处理
          // 目前先用文本摘要保证所有 provider 都不会超限
          return { type: 'text' as const, value: mcpResultToTextSummary(result) }
        }

        // 无多模态内容时，走默认的 JSON 序列化
        return { type: 'text' as const, value: JSON.stringify(result) }
      }
    })
  }

  return tools
}
