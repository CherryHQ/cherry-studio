import { CacheService } from '@main/services/CacheService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { MCPServer } from '@types'

import { loggerService } from '../../services/LoggerService'
import { reduxService } from '../../services/ReduxService'

const logger = loggerService.withContext('MCPApiService')

// Cache configuration
const MCP_SERVERS_CACHE_KEY = 'api-server:mcp-servers'
const MCP_SERVERS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const cachedServers: Record<string, Server> = {}

/**
 * Get servers directly from Redux store
 */
export async function getMCPServersFromRedux(): Promise<MCPServer[]> {
  try {
    logger.debug('Getting servers from Redux store')

    // Try to get from cache first (faster)
    const cachedServers = CacheService.get<MCPServer[]>(MCP_SERVERS_CACHE_KEY)
    if (cachedServers) {
      logger.debug('MCP servers resolved from cache', { count: cachedServers.length })
      return cachedServers
    }

    // If cache is not available, get fresh data from Redux
    const servers = await reduxService.select<MCPServer[]>('state.mcp.servers')
    const serverList = servers || []

    // Cache the results
    CacheService.set(MCP_SERVERS_CACHE_KEY, serverList, MCP_SERVERS_CACHE_TTL)

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
      return server
    }

    const newServer = createMcpServer(mcpServer.name, '0.1.0')
    cachedServers[id] = newServer
    return newServer
  }
  logger.debug('Returning cached MCP server', { id, hasHandlers: Boolean(server) })
  return server
}
