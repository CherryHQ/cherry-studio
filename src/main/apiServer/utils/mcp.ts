import mcpService from '@main/services/MCPService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { MCPServer } from '@types'

import { loggerService } from '../../services/LoggerService'
import { reduxService } from '../../services/ReduxService'

const logger = loggerService.withContext('MCPApiService')

const cachedServers: Record<string, Server> = {}

async function handleListToolsRequest(request: any, extra: any): Promise<ListToolsResult> {
  logger.debug('Handling list tools request', { request: request, extra: extra })
  const serverId: string = request.params._meta.serverId
  const serverConfig = await getMcpServerConfigById(serverId)
  if (!serverConfig) {
    throw new Error(`Server not found: ${serverId}`)
  }
  const client = await mcpService.initClient(serverConfig)
  return await client.listTools()
}

async function handleCallToolRequest(request: any, extra: any): Promise<any> {
  logger.debug('Handling call tool request', { request: request, extra: extra })
  const serverId: string = request.params._meta.serverId
  const serverConfig = await getMcpServerConfigById(serverId)
  if (!serverConfig) {
    throw new Error(`Server not found: ${serverId}`)
  }
  const client = await mcpService.initClient(serverConfig)
  return client.callTool(request.params)
}

async function getMcpServerConfigById(id: string): Promise<MCPServer | undefined> {
  const servers = await getServersFromRedux()
  return servers.find((s) => s.id === id || s.name === id)
}

/**
 * Get servers directly from Redux store
 */
async function getServersFromRedux(): Promise<MCPServer[]> {
  try {
    const servers = await reduxService.select<MCPServer[]>('state.mcp.servers')
    logger.silly(`Fetched ${servers?.length || 0} servers from Redux store`)
    return servers || []
  } catch (error: any) {
    logger.error('Failed to get servers from Redux:', error)
    return []
  }
}

export async function getMcpServerById(id: string): Promise<Server> {
  const server = cachedServers[id]
  if (!server) {
    const servers = await getServersFromRedux()
    const mcpServer = servers.find((s) => s.id === id || s.name === id)
    if (!mcpServer) {
      throw new Error(`Server not found: ${id}`)
    }

    const createMcpServer = (name: string, version: string): Server => {
      const server = new Server({ name: name, version }, { capabilities: { tools: {} } })
      server.setRequestHandler(ListToolsRequestSchema, handleListToolsRequest)
      server.setRequestHandler(CallToolRequestSchema, handleCallToolRequest)
      return server
    }

    const newServer = createMcpServer(mcpServer.name, '0.1.0')
    cachedServers[id] = newServer
    return newServer
  }
  logger.silly('getMcpServer ', { server: server })
  return server
}
