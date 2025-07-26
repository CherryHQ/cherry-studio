import mcpService from '@main/services/MCPService'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp'
import { JSONRPCMessage, JSONRPCMessageSchema, MessageExtraInfo } from '@modelcontextprotocol/sdk/types'
import { MCPServer } from '@types'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { Context } from 'hono'

import { loggerService } from '../../services/LoggerService'
import { reduxService } from '../../services/ReduxService'

const logger = loggerService.withContext('MCPApiService')

interface McpServerDTO {
  id: MCPServer['id']
  name: MCPServer['name']
  type: MCPServer['type']
  description: MCPServer['description']
}

/**
 * MCPApiService - API layer for MCP server management
 *
 * This service provides a REST API interface for MCP servers while integrating
 * with the existing application architecture:
 *
 * 1. Uses ReduxService to access the renderer's Redux store directly
 * 2. Syncs changes back to the renderer via Redux actions
 * 3. Leverages existing MCPService for actual server connections
 * 4. Provides session management for API clients
 */
class MCPApiService extends EventEmitter {
  private transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  })

  constructor() {
    super()
    this.initMcpServer()
    logger.silly('MCPApiService initialized')
  }

  private initMcpServer() {
    this.transport.onmessage = this.onMessage
  }

  /**
   * Get servers directly from Redux store
   */
  private async getServersFromRedux(): Promise<MCPServer[]> {
    try {
      logger.silly('Getting servers from Redux store')

      // Try to get from cache first (faster)
      const cachedServers = reduxService.selectSync<MCPServer[]>('state.mcp.servers')
      if (cachedServers && Array.isArray(cachedServers)) {
        logger.silly(`Found ${cachedServers.length} servers in Redux cache`)
        return cachedServers
      }

      // If cache is not available, get fresh data
      const servers = await reduxService.select<MCPServer[]>('state.mcp.servers')
      logger.silly(`Fetched ${servers?.length || 0} servers from Redux store`)
      return servers || []
    } catch (error: any) {
      logger.error('Failed to get servers from Redux:', error)
      return []
    }
  }

  // get all activated servers
  async getAllServers(): Promise<McpServerDTO[]> {
    try {
      logger.silly('getAllServers called')
      const servers = await this.getServersFromRedux()
      logger.silly(`Returning ${servers.length} servers`)
      return servers
        .filter((s) => s.isActive)
        .map((server) => ({
          id: server.id,
          name: server.name,
          type: server.type,
          description: server.description
        }))
    } catch (error: any) {
      logger.error('Failed to get all servers:', error)
      throw new Error('Failed to retrieve servers')
    }
  }

  // get server by id
  async getServerById(id: string): Promise<MCPServer | null> {
    try {
      logger.silly(`getServerById called with id: ${id}`)
      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === id)
      if (!server) {
        logger.warn(`Server with id ${id} not found`)
        return null
      }
      logger.silly(`Returning server with id ${id}`)
      return server
    } catch (error: any) {
      logger.error(`Failed to get server with id ${id}:`, error)
      throw new Error('Failed to retrieve server')
    }
  }

  async getServerInfo(id: string): Promise<any> {
    try {
      logger.silly(`getServerInfo called with id: ${id}`)
      const server = await this.getServerById(id)
      if (!server) {
        logger.warn(`Server with id ${id} not found`)
        return null
      }
      logger.silly(`Returning server info for id ${id}`)

      const client = await mcpService.initClient(server)

      const [version, tools, prompts, resources] = await Promise.all([
        client.getServerVersion(),
        client.listTools(),
        client.listPrompts(),
        client.listResources()
      ])

      return {
        id: server.id,
        name: server.name,
        type: server.type,
        description: server.description,
        version,
        tools,
        prompts,
        resources
      }
    } catch (error: any) {
      logger.error(`Failed to get server info with id ${id}:`, error)
      throw new Error('Failed to retrieve server info')
    }
  }

  async handleRequest(c: Context, server: MCPServer) {
    const req = c.env.IncomingMessage
    const res = c.env.Response
    const client = await mcpService.initClient(server)
    logger.info(`Handling request for server with id ${client}`)
    const parsedBody = await c.req.parseBody()

    let messages: JSONRPCMessage[]

    // handle batch and single messages
    if (Array.isArray(parsedBody)) {
      messages = parsedBody.map((msg) => JSONRPCMessageSchema.parse(msg))
    } else {
      messages = [JSONRPCMessageSchema.parse(parsedBody)]
    }
    // messages.forEach((message) => {})

    this.transport.handleRequest(req, res, messages)
  }

  private onMessage(message: JSONRPCMessage, extra?: MessageExtraInfo) {
    logger.info(`Received message: ${JSON.stringify(message)}`, extra)
    // Handle message here
  }
}

export const mcpApiService = new MCPApiService()
