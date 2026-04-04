import { mcpServerService } from '@data/services/McpServerService'
import { application } from '@main/core/application'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp'
import type { JSONRPCMessage, Tool } from '@modelcontextprotocol/sdk/types'
import { isJSONRPCRequest, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import type { IncomingMessage, ServerResponse } from 'http'

import { loggerService } from '../../services/LoggerService'
import { createMcpServerForTransport } from '../utils/mcp'

const logger = loggerService.withContext('MCPApiService')
const transports: Record<string, StreamableHTTPServerTransport> = {}

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

  async handleRequest(req: Request, res: Response, server: MCPServer) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    logger.debug('Handling MCP request', { sessionId, serverId: server.id })
    let transport: StreamableHTTPServerTransport
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId]
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport
        }
      })

      transport.onclose = () => {
        logger.info('Transport closed', { sessionId })
        if (transport.sessionId) {
          delete transports[transport.sessionId]
        }
      }
      const mcpServer = await createMcpServerForTransport(server.id)
      await mcpServer.connect(transport)
    }
    const jsonpayload = req.body
    const messages: JSONRPCMessage[] = []

    if (Array.isArray(jsonpayload)) {
      for (const payload of jsonpayload) {
        const message = JSONRPCMessageSchema.parse(payload)
        messages.push(message)
      }
    } else {
      const message = JSONRPCMessageSchema.parse(jsonpayload)
      messages.push(message)
    }

    for (const message of messages) {
      if (isJSONRPCRequest(message)) {
        if (!message.params) {
          message.params = {}
        }
        if (!message.params._meta) {
          message.params._meta = {}
        }
        message.params._meta.serverId = server.id
      }
    }

    logger.debug('Dispatching MCP request', {
      sessionId: transport.sessionId ?? sessionId,
      messageCount: messages.length
    })
    await transport.handleRequest(req as IncomingMessage, res as ServerResponse, messages)
  }
}

export const mcpApiService = new MCPApiService()
