import { loggerService } from '@logger'
import store from '@renderer/store'
import type { MCPCallToolResponse, MCPTool, MCPToolResponse } from '@renderer/types'
import { callMCPTool, getMcpServerByTool, isToolAutoApproved } from '@renderer/utils/mcp-tools'
import {
  confirmSameNameTools,
  requestToolConfirmation,
  sendToolApprovalNotification,
  setToolIdToNameMapping
} from '@renderer/utils/userConfirmation'
import { type Tool, type ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7 } from 'json-schema'

const logger = loggerService.withContext('MCP-utils')

// Setup tools configuration based on provided parameters
export function setupToolsConfig(
  mcpTools?: MCPTool[],
  allowedTools?: string[]
): Record<string, Tool<any, any>> | undefined {
  let tools: ToolSet = {}

  if (!mcpTools?.length) {
    return undefined
  }

  tools = convertMcpToolsToAiSdkTools(mcpTools, allowedTools)

  return tools
}

/**
 * 检查 MCP 工具调用结果是否包含可能携带大体积 base64 数据的多模态内容。
 * 包括 image、audio 以及含 blob 的 resource 类型。
 */
export function hasMultimodalContent(result: MCPCallToolResponse): boolean {
  return (
    Array.isArray(result?.content) &&
    result.content.some(
      (item) => item.type === 'image' || item.type === 'audio' || (item.type === 'resource' && !!item.resource?.blob)
    )
  )
}

/**
 * 将 MCP 工具调用结果转换为纯文本摘要，把图片/音频/resource blob 替换为文本占位描述，
 * 避免 base64 数据超出消息大小限制（如 kimi 的 4MB 限制）。
 */
export function mcpResultToTextSummary(result: MCPCallToolResponse): string {
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
      case 'resource':
        if (item.resource?.blob) {
          parts.push(
            `[Resource: ${item.resource.mimeType || 'application/octet-stream'}, uri=${item.resource.uri || 'unknown'}, delivered to user]`
          )
        } else {
          parts.push(item.resource?.text || JSON.stringify(item))
        }
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
export function convertMcpToolsToAiSdkTools(mcpTools: MCPTool[], allowedTools?: string[]): ToolSet {
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
        let isAutoApproveEnabled = isToolAutoApproved(mcpTool, server, allowedTools)

        // For hub invoke/exec, resolve the underlying tool and check its server's auto-approve config
        if (
          !isAutoApproveEnabled &&
          mcpTool.serverId === 'hub' &&
          (mcpTool.name === 'invoke' || mcpTool.name === 'exec')
        ) {
          const underlyingToolName = (params as Record<string, unknown>)?.name as string | undefined
          if (underlyingToolName) {
            try {
              const resolved = await window.api.mcp.resolveHubTool(underlyingToolName)
              if (resolved) {
                const underlyingServer = store.getState().mcp.servers.find((s) => s.id === resolved.serverId)
                if (underlyingServer) {
                  isAutoApproveEnabled = !underlyingServer.disabledAutoApproveTools?.includes(resolved.toolName)
                }
              }
            } catch (err) {
              logger.warn('Failed to resolve hub tool for auto-approve check', err as Error)
            }
          }
        }

        let confirmed = true

        if (!isAutoApproveEnabled) {
          // Register mapping so confirmSameNameTools can batch-confirm pending tools.
          // For hub invoke/exec, use the underlying tool name so tools targeting the
          // same underlying server+tool are grouped together.
          const mappingName =
            mcpTool.serverId === 'hub' && (mcpTool.name === 'invoke' || mcpTool.name === 'exec')
              ? ((params as Record<string, unknown>)?.name as string) || mcpTool.name
              : mcpTool.name
          setToolIdToNameMapping(toolCallId, mappingName)

          // Send system notification for tool approval
          sendToolApprovalNotification(mcpTool.name)

          // 请求用户确认
          logger.debug(`Requesting user confirmation for tool: ${mcpTool.name}`)
          confirmed = await requestToolConfirmation(toolCallId)

          if (confirmed) {
            // Auto-confirm other pending tools with the same name
            confirmSameNameTools(mappingName)
          }
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
      // 将多模态结果 (image/audio/resource blob) 转为文本摘要，避免 base64 超出消息大小限制。
      // 图片/音频已通过 IMAGE_COMPLETE chunk 展示给用户。
      // TODO: 待 AI SDK 支持 provider 感知后，可按 provider 返回 media 格式。
      toModelOutput(rawOutput: unknown) {
        // rawOutput 来自上方 execute 的 return result，类型始终为 MCPCallToolResponse
        // mcpResultToTextSummary 内部已有 null/content 校验，不会因意外输入崩溃
        const result = rawOutput as MCPCallToolResponse
        return { type: 'text' as const, value: mcpResultToTextSummary(result) }
      }
    })
  }

  return tools
}
