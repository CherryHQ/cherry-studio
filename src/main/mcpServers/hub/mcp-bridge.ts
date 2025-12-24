import { loggerService } from '@logger'
import { BuiltinMCPServerNames, type MCPServer, type MCPTool } from '@types'

const logger = loggerService.withContext('MCPServer:Hub:Bridge')

let mcpServiceInstance: MCPServiceInterface | null = null
let mcpServersGetter: (() => MCPServer[]) | null = null

interface MCPServiceInterface {
  listTools(_: null, server: MCPServer): Promise<MCPTool[]>
  callTool(
    _: null,
    args: { server: MCPServer; name: string; args: unknown; callId?: string }
  ): Promise<{ content: Array<{ type: string; text?: string }> }>
}

export function setMCPService(service: MCPServiceInterface): void {
  mcpServiceInstance = service
}

export function setMCPServersGetter(getter: () => MCPServer[]): void {
  mcpServersGetter = getter
}

export function getActiveServers(): MCPServer[] {
  if (!mcpServersGetter) {
    logger.warn('MCP servers getter not set')
    return []
  }

  const servers = mcpServersGetter()
  return servers.filter((s) => s.isActive && s.name !== BuiltinMCPServerNames.hub)
}

export async function listToolsFromServer(server: MCPServer): Promise<MCPTool[]> {
  if (!mcpServiceInstance) {
    logger.error('MCP service not initialized')
    return []
  }

  try {
    return await mcpServiceInstance.listTools(null, server)
  } catch (error) {
    logger.error(`Failed to list tools from server ${server.name}:`, error as Error)
    return []
  }
}

export async function callMcpTool(toolId: string, params: unknown): Promise<unknown> {
  if (!mcpServiceInstance) {
    throw new Error('MCP service not initialized')
  }

  const parts = toolId.split('__')
  if (parts.length < 2) {
    throw new Error(`Invalid tool ID format: ${toolId}`)
  }

  const serverId = parts[0]
  const toolName = parts.slice(1).join('__')

  const servers = getActiveServers()
  const server = servers.find((s) => s.id === serverId)

  if (!server) {
    throw new Error(`Server not found: ${serverId}`)
  }

  logger.debug(`Calling tool ${toolName} on server ${server.name}`)

  const result = await mcpServiceInstance.callTool(null, {
    server,
    name: toolName,
    args: params
  })

  return extractToolResult(result)
}

function extractToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
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
