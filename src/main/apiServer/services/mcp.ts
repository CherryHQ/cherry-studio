import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import type { Tool } from '@modelcontextprotocol/sdk/types'
import type { MCPServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('MCPApiService')

/**
 * MCPApiService - API layer for MCP server management
 *
 * This service provides a REST API interface for MCP servers:
 * 1. Reads server config from SQLite via McpServerService
 * 2. Leverages MCPService for actual server connections
 * 3. Provides session management for API clients
 */
class MCPApiService {
  constructor() {
    logger.debug('MCPApiService initialized')
  }

  // get all activated servers
  async getAllActiveServers(): Promise<MCPServer[]> {
    const { items: servers } = await mcpServerService.list({ isActive: true })
    logger.debug('Returning active servers', { count: servers.length })
    return servers
  }

  // get server by id
  async getServerById(id: string): Promise<MCPServer | null> {
    try {
      logger.debug('getServerById called', { id })
      const server = await mcpServerService.getById(id)
      logger.debug('Returning server', { id })
      return server
    } catch (error: any) {
      if (error?.code === 'NOT_FOUND') {
        logger.warn('Server not found', { id })
        return null
      }
      logger.error('Failed to get server', { id, error })
      throw new Error('Failed to retrieve server')
    }
  }

  async getServerInfo(
    id: string
  ): Promise<(Pick<MCPServer, 'id' | 'name' | 'type' | 'description'> & { tools: Tool[] }) | null> {
    try {
      const server = await this.getServerById(id)
      if (!server) {
        logger.warn('Server not found while fetching info', { id })
        return null
      }

      const client = await application.get('MCPService').initClient(server)
      const tools = await client.listTools()
      return {
        id: server.id,
        name: server.name,
        type: server.type,
        description: server.description,
        tools: tools.tools
      }
    } catch (error: any) {
      logger.error('Failed to get server info', { id, error })
      throw new Error('Failed to retrieve server info')
    }
  }
}

// TODO: The lazy getter below is a timing workaround — without it, the
// module-level singleton would be constructed during ESM evaluation, before
// preboot completes. The apiServer subsystem (MCPApiService, routes, app.ts,
// ApiServer, ApiServerService) has tangled coupling that needs to be untangled
// as a whole; this getter should be removed as part of that broader refactor.
let _mcpApiService: MCPApiService | null = null

export function getMcpApiService(): MCPApiService {
  if (!_mcpApiService) _mcpApiService = new MCPApiService()
  return _mcpApiService
}
