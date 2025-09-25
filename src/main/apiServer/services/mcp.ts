import mcpService from '@main/services/MCPService'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp'
import {
  isJSONRPCRequest,
  JSONRPCMessage,
  JSONRPCMessageSchema,
  MessageExtraInfo
} from '@modelcontextprotocol/sdk/types'
import { MCPServer } from '@types'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { Request, Response } from 'express'
import { IncomingMessage, ServerResponse } from 'http'

import { loggerService } from '../../services/LoggerService'
import { getMcpServerById, getMCPServersFromRedux } from '../utils/mcp'

const logger = loggerService.withContext('MCPApiService')
const transports: Record<string, StreamableHTTPServerTransport> = {}

interface McpServerDTO {
  id: MCPServer['id']
  name: MCPServer['name']
  type: MCPServer['type']
  description: MCPServer['description']
  url: string
}

interface McpServersResp {
  servers: Record<string, McpServerDTO>
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
    logger.debug('MCPApiService initialized')
  }

  private initMcpServer() {
    this.transport.onmessage = this.onMessage
  }

  // get all activated servers
  async getAllServers(req: Request): Promise<McpServersResp> {
    try {
      const servers = await getMCPServersFromRedux()
      logger.debug('Returning servers from Redux', { count: servers.length })
      const resp: McpServersResp = {
        servers: {}
      }
      for (const server of servers) {
        if (server.isActive) {
          resp.servers[server.id] = {
            id: server.id,
            name: server.name,
            type: 'streamableHttp',
            description: server.description,
            url: `${req.protocol}://${req.host}/v1/mcps/${server.id}/mcp`
          }
        }
      }
      return resp
    } catch (error: any) {
      logger.error('Failed to get all servers', { error })
      throw new Error('Failed to retrieve servers')
    }
  }

  // get server by id
  async getServerById(id: string): Promise<MCPServer | null> {
    try {
      logger.debug('getServerById called', { id })
      const servers = await getMCPServersFromRedux()
      const server = servers.find((s) => s.id === id)
      if (!server) {
        logger.warn('Server not found', { id })
        return null
      }
      logger.debug('Returning server', { id })
      return server
    } catch (error: any) {
      logger.error('Failed to get server', { id, error })
      throw new Error('Failed to retrieve server')
    }
  }

  async getServerInfo(id: string): Promise<any> {
    try {
      const server = await this.getServerById(id)
      if (!server) {
        logger.warn('Server not found while fetching info', { id })
        return null
      }

      const client = await mcpService.initClient(server)
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
      const mcpServer = await getMcpServerById(server.id)
      if (mcpServer) {
        await mcpServer.connect(transport)
      }
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

  private onMessage(message: JSONRPCMessage, extra?: MessageExtraInfo) {
    logger.debug('Received MCP message', { message, extra })
    // Handle message here
  }
}

export const mcpApiService = new MCPApiService()
