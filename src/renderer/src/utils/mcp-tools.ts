import { loggerService } from '@logger'
import { currentSpan } from '@renderer/services/SpanManagerService'
import store from '@renderer/store'
import { addMCPServer, hubMCPServer } from '@renderer/store/mcp'
import type { MCPCallToolResponse, MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { BuiltinMCPServerNames } from '@renderer/types'
import { nanoid } from 'nanoid'

const logger = loggerService.withContext('Utils:MCPTools')

export async function callBuiltInTool(toolResponse: MCPToolResponse): Promise<MCPCallToolResponse | undefined> {
  logger.info(`[BuiltIn] Calling Built-in Tool: ${toolResponse.tool.name}`, toolResponse.tool)

  if (
    toolResponse.tool.name === 'think' &&
    typeof toolResponse.arguments === 'object' &&
    toolResponse.arguments !== null &&
    !Array.isArray(toolResponse.arguments)
  ) {
    const thought = toolResponse.arguments?.thought
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: (thought as string) || ''
        }
      ]
    }
  }

  return undefined
}

export async function callMCPTool(
  toolResponse: MCPToolResponse,
  topicId?: string,
  modelName?: string
): Promise<MCPCallToolResponse> {
  logger.info(
    `Calling Tool: ${toolResponse.id} ${toolResponse.tool.serverName} ${toolResponse.tool.name}`,
    toolResponse.tool
  )
  try {
    const server = getMcpServerByTool(toolResponse.tool)

    if (!server) {
      throw new Error(`Server not found: ${toolResponse.tool.serverName}`)
    }

    const resp = await window.api.mcp.callTool(
      {
        server,
        name: toolResponse.tool.name,
        args: toolResponse.arguments,
        callId: toolResponse.id
      },
      topicId ? currentSpan(topicId, modelName)?.spanContext() : undefined
    )
    if (toolResponse.tool.serverName === BuiltinMCPServerNames.mcpAutoInstall) {
      if (resp.data) {
        const mcpServer: MCPServer = {
          id: `f${nanoid()}`,
          name: resp.data.name,
          description: resp.data.description,
          baseUrl: resp.data.baseUrl,
          command: resp.data.command,
          args: resp.data.args,
          env: resp.data.env,
          registryUrl: '',
          isActive: false,
          provider: 'CherryAI'
        }
        store.dispatch(addMCPServer(mcpServer))
      }
    }

    logger.info(`Tool called: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, resp)
    return resp
  } catch (e) {
    logger.error(`Error calling Tool: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, e as Error)
    return Promise.resolve({
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error calling tool ${toolResponse.tool.name}: ${e instanceof Error ? e.stack || e.message || 'No error details available' : JSON.stringify(e)}`
        }
      ]
    })
  }
}

export function getMcpServerByTool(tool: MCPTool) {
  const servers = store.getState().mcp.servers
  const server = servers.find((s) => s.id === tool.serverId)
  if (server) {
    return server
  }
  // For hub server (auto mode), the server isn't in the store
  // Return the hub server constant if the tool's serverId matches
  if (tool.serverId === 'hub') {
    return hubMCPServer
  }
  return undefined
}

export function isToolAutoApproved(tool: MCPTool, server?: MCPServer, allowedTools?: string[]): boolean {
  if (tool.isBuiltIn) {
    return true
  }
  // Check agent-level pre-authorization (allowed_tools from Agent Settings)
  if (allowedTools?.includes(tool.id)) {
    return true
  }
  // Fall back to server-level auto-approve setting
  const effectiveServer = server ?? getMcpServerByTool(tool)
  if (!effectiveServer) return false
  // Hub meta-tools: read-only tools (list, inspect) are auto-approved;
  // execution tools (invoke, exec) require approval.
  if (effectiveServer.id === 'hub') {
    return tool.name === 'list' || tool.name === 'inspect'
  }
  return !effectiveServer.disabledAutoApproveTools?.includes(tool.name)
}
