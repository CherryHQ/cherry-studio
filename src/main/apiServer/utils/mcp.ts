import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import mcpService from '@main/services/MCPService'
import { reduxService } from '@main/services/ReduxService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { MCPServer } from '@types'

const logger = loggerService.withContext('MCPApiService')

// Cache configuration
const MCP_SERVERS_CACHE_KEY = 'api-server:mcp-servers'
const MCP_SERVERS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const cachedServers: Record<string, Server> = {}

async function handleListToolsRequest(request: any, extra: any): Promise<ListToolsResult> {
  logger.debug('Handling list tools request', { request: request, extra: extra })
  const serverId: string = request.params._meta.serverId
  const serverConfig = await getMcpServerConfigById(serverId)
  if (!serverConfig) {
    throw new Error(`Server not found: ${serverId}`)
  }
  const client = await mcpService.initClient(serverConfig)
  return client.listTools()
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
  const servers = await getMCPServersFromRedux()
  return servers.find((s) => s.id === id || s.name === id)
}

/**
 * Get servers directly from Redux store
 */
export async function getMCPServersFromRedux(): Promise<MCPServer[]> {
  try {
    logger.debug('Getting servers from Redux store')

    // Try to get from cache first (faster)
    const cachedServers = cacheService.get<MCPServer[]>(MCP_SERVERS_CACHE_KEY)
    if (cachedServers) {
      logger.debug('MCP servers resolved from cache', { count: cachedServers.length })
      return cachedServers
    }

    // If cache is not available, get fresh data from Redux
    const servers = await reduxService.select<MCPServer[]>('state.mcp.servers')
    const serverList = servers || []

    // Cache the results
    cacheService.set(MCP_SERVERS_CACHE_KEY, serverList, MCP_SERVERS_CACHE_TTL)

    logger.debug('Fetched servers from Redux store', { count: serverList.length })
    return serverList
  } catch (error: any) {
    logger.error('Failed to get servers from Redux', { error })
    return []
  }
}

export async function getMcpServerById(id: string): Promise<Server> {
  const server = cachedServers[id]
  if (!server) {
    const servers = await getMCPServersFromRedux()
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
  logger.debug('Returning cached MCP server', { id, hasHandlers: Boolean(server) })
  return server
}
