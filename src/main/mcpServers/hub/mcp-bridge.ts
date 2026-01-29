/**
 * Bridge module for Hub server to access MCPService.
 * Re-exports the methods needed by tool-registry and runtime.
 */
import mcpService from '@main/services/MCPService'
import { generateMcpToolFunctionName } from '@shared/mcp'
import type { MCPCallToolResponse, MCPTool, MCPToolResultContent } from '@types'

import type { GeneratedTool } from './types'

export const listAllTools = () => mcpService.listAllActiveServerTools()

const toolFunctionNameToIdMap = new Map<string, { serverId: string; toolName: string }>()

export async function refreshToolMap(): Promise<void> {
  const tools = await listAllTools()
  syncToolMapFromTools(tools)
}

export function syncToolMapFromTools(tools: MCPTool[]): void {
  toolFunctionNameToIdMap.clear()
  const existingNames = new Set<string>()
  for (const tool of tools) {
    const functionName = generateMcpToolFunctionName(tool.serverName, tool.name, existingNames)
    toolFunctionNameToIdMap.set(functionName, { serverId: tool.serverId, toolName: tool.name })
  }
}

export function syncToolMapFromGeneratedTools(tools: GeneratedTool[]): void {
  toolFunctionNameToIdMap.clear()
  for (const tool of tools) {
    toolFunctionNameToIdMap.set(tool.functionName, { serverId: tool.serverId, toolName: tool.toolName })
  }
}

export function clearToolMap(): void {
  toolFunctionNameToIdMap.clear()
}

export const callMcpTool = async (functionName: string, params: unknown, callId?: string): Promise<unknown> => {
  const toolInfo = toolFunctionNameToIdMap.get(functionName)
  if (!toolInfo) {
    await refreshToolMap()
    const retryToolInfo = toolFunctionNameToIdMap.get(functionName)
    if (!retryToolInfo) {
      throw new Error(`Tool not found: ${functionName}`)
    }
    const toolId = `${retryToolInfo.serverId}__${retryToolInfo.toolName}`
    const result = await mcpService.callToolById(toolId, params, callId)
    throwIfToolError(result)
    return extractToolResult(result)
  }
  const toolId = `${toolInfo.serverId}__${toolInfo.toolName}`
  const result = await mcpService.callToolById(toolId, params, callId)
  throwIfToolError(result)
  return extractToolResult(result)
}

export const abortMcpTool = async (callId: string): Promise<boolean> => {
  return mcpService.abortTool(null as unknown as Electron.IpcMainInvokeEvent, callId)
}

function extractToolResult(result: MCPCallToolResponse): unknown {
  if (!result.content || result.content.length === 0) {
    return null
  }

  const textContent = result.content.find((c) => c.type === 'text')
  if (textContent?.text) {
    try {
      return JSON.parse(textContent.text)
    } catch {
      return textContent.text
    }
  }

  return result.content
}

function throwIfToolError(result: MCPCallToolResponse): void {
  if (!result.isError) {
    return
  }

  const textContent = extractTextContent(result.content)
  throw new Error(textContent ?? 'Tool execution failed')
}

function extractTextContent(content: MCPToolResultContent[] | undefined): string | undefined {
  if (!content || content.length === 0) {
    return undefined
  }

  const textBlock = content.find((item) => item.type === 'text' && item.text)
  return textBlock?.text
}
