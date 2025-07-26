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
import { reduxService } from '../../services/ReduxService'
import { getMcpServerById } from '../utils/mcp'

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
  async getAllServers(req: Request): Promise<McpServersResp> {
    try {
      const servers = await this.getServersFromRedux()
      logger.silly(`Returning ${servers.length} servers`)
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
      const tools = await client.listTools()

      logger.info(`Server with id ${id} info:`, { tools: JSON.stringify(tools) })

      // const [version, tools, prompts, resources] = await Promise.all([
      //   () => {
      //     try {
      //       return client.getServerVersion()
      //     } catch (error) {
      //       logger.error(`Failed to get server version for id ${id}:`, { error: error })
      //       return '1.0.0'
      //     }
      //   },
      //   (() => {
      //     try {
      //       return client.listTools()
      //     } catch (error) {
      //       logger.error(`Failed to list tools for id ${id}:`, { error: error })
      //       return []
      //     }
      //   })(),
      //   (() => {
      //     try {
      //       return client.listPrompts()
      //     } catch (error) {
      //       logger.error(`Failed to list prompts for id ${id}:`, { error: error })
      //       return []
      //     }
      //   })(),
      //   (() => {
      //     try {
      //       return client.listResources()
      //     } catch (error) {
      //       logger.error(`Failed to list resources for id ${id}:`, { error: error })
      //       return []
      //     }
      //   })()
      // ])

      return {
        id: server.id,
        name: server.name,
        type: server.type,
        description: server.description,
        tools
      }
    } catch (error: any) {
      logger.error(`Failed to get server info with id ${id}:`, error)
      throw new Error('Failed to retrieve server info')
    }
  }

  async handleRequest(req: Request, res: Response, server: MCPServer) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    logger.silly(`Handling request for server with sessionId ${sessionId}`)
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
        logger.info(`Transport for sessionId ${sessionId} closed`)
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

    logger.info(`Request body`, { rawBody: req.body, messages: JSON.stringify(messages) })
    await transport.handleRequest(req as IncomingMessage, res as ServerResponse, messages)
  }

  private onMessage(message: JSONRPCMessage, extra?: MessageExtraInfo) {
    logger.info(`Received message: ${JSON.stringify(message)}`, extra)
    // Handle message here
  }
}

export const mcpApiService = new MCPApiService()
