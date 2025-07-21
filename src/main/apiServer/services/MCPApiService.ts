import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { MCPServer } from '@types'
import { EventEmitter } from 'events'

import { loggerService } from '../../services/LoggerService'
import McpService from '../../services/MCPService'
import { reduxService } from '../../services/ReduxService'

const logger = loggerService.withContext('MCPApiService')

interface MCPSession {
  id: string
  serverId: string
  serverName: string
  client?: Client
  isConnected: boolean
  connectionTime?: Date
  lastActivity?: Date
  error?: string
}

interface ToolToggleResult {
  serverName: string
  toolName: string
  enabled: boolean
}

interface StreamingCallbacks {
  onProgress?: (progress: { current: number; total?: number; message?: string }) => Promise<void>
  onChunk?: (chunk: { type: string; content: any }) => Promise<void>
  onError?: (error: Error) => Promise<void>
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
  private sessions: Map<string, MCPSession> = new Map()

  constructor() {
    super()
    logger.silly('MCPApiService initialized')
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
    } catch (error) {
      logger.error('Failed to get servers from Redux:', error)
      return []
    }
  }

  /**
   * Sync changes back to renderer via Redux actions
   */
  private async syncToRedux(server: MCPServer, action: 'add' | 'update' | 'delete'): Promise<void> {
    try {
      logger.silly(`Syncing ${action} action to Redux for server: ${server.name}`)

      switch (action) {
        case 'add':
          await reduxService.dispatch({
            type: 'mcp/addMCPServer',
            payload: server
          })
          break
        case 'update':
          await reduxService.dispatch({
            type: 'mcp/updateMCPServer',
            payload: server
          })
          break
        case 'delete':
          await reduxService.dispatch({
            type: 'mcp/deleteMCPServer',
            payload: server.id
          })
          break
      }

      logger.silly(`Successfully synced ${action} to Redux`)
    } catch (error) {
      logger.error('Failed to sync to Redux:', error)
      throw error
    }
  }

  async getAllServers(): Promise<MCPServer[]> {
    try {
      logger.silly('getAllServers called')
      const servers = await this.getServersFromRedux()
      logger.silly(`Returning ${servers.length} servers`)
      return servers
    } catch (error) {
      logger.error('Failed to get all servers:', error)
      throw new Error('Failed to retrieve servers')
    }
  }

  async createServer(serverData: Partial<MCPServer>): Promise<MCPServer> {
    try {
      logger.silly(`createServer called for: ${serverData.name}`)

      // Validate required fields
      if (!serverData.name) {
        throw new Error('Server name is required')
      }

      // Check if server with same name already exists
      const existingServers = await this.getServersFromRedux()
      const existingServer = existingServers.find((server) => server.name === serverData.name)
      if (existingServer) {
        throw new Error(`Server with name '${serverData.name}' already exists`)
      }

      // Generate unique ID
      const id = `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      // Create server object with defaults
      const server: MCPServer = {
        id,
        name: serverData.name,
        type: serverData.type || 'stdio',
        description: serverData.description || '',
        baseUrl: serverData.baseUrl,
        command: serverData.command,
        registryUrl: serverData.registryUrl,
        args: serverData.args || [],
        env: serverData.env || {},
        isActive: serverData.isActive !== undefined ? serverData.isActive : false,
        disabledTools: serverData.disabledTools || [],
        disabledAutoApproveTools: serverData.disabledAutoApproveTools || [],
        configSample: serverData.configSample,
        headers: serverData.headers || {},
        searchKey: serverData.searchKey,
        provider: serverData.provider,
        providerUrl: serverData.providerUrl,
        logoUrl: serverData.logoUrl,
        tags: serverData.tags || [],
        timeout: serverData.timeout || 60
      }

      logger.silly(`Created server object with ID: ${id}`)

      // Sync to Redux store (which handles persistence)
      await this.syncToRedux(server, 'add')

      logger.info(`Created MCP server: ${server.name} (${id})`)
      this.emit('serverCreated', server)

      return server
    } catch (error) {
      logger.error('Failed to create server:', error)
      throw error
    }
  }

  async updateServer(serverId: string, updateData: Partial<MCPServer>): Promise<MCPServer> {
    try {
      logger.silly(`updateServer called for ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const existingServer = servers.find((server) => server.id === serverId)
      if (!existingServer) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Validate name uniqueness if name is being updated
      if (updateData.name && updateData.name !== existingServer.name) {
        const nameExists = servers.some((server) => server.id !== serverId && server.name === updateData.name)
        if (nameExists) {
          throw new Error(`Server with name '${updateData.name}' already exists`)
        }
      }

      // Update server object
      const updatedServer: MCPServer = {
        ...existingServer,
        ...updateData,
        id: serverId // Ensure ID cannot be changed
      }

      logger.silly(`Updated server object for: ${updatedServer.name}`)

      // Sync to Redux store (which handles persistence)
      await this.syncToRedux(updatedServer, 'update')

      logger.info(`Updated MCP server: ${updatedServer.name} (${serverId})`)
      this.emit('serverUpdated', updatedServer)

      // If the server was active and configuration changed, restart the session
      if (existingServer.isActive && this.hasConfigurationChanged(existingServer, updatedServer)) {
        try {
          await this.restartServerSession(serverId)
        } catch (restartError) {
          logger.warn(`Failed to restart session for updated server ${serverId}:`, restartError)
        }
      }

      return updatedServer
    } catch (error) {
      logger.error('Failed to update server:', error)
      throw error
    }
  }

  async deleteServer(serverId: string): Promise<void> {
    try {
      logger.silly(`deleteServer called for ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Stop any active session first
      if (this.sessions.has(serverId)) {
        await this.deleteServerSession(serverId)
      }

      logger.silly(`Deleting server: ${server.name}`)

      // Sync to Redux store (which handles persistence)
      await this.syncToRedux(server, 'delete')

      // Also remove from MCPService if it exists there
      try {
        await McpService.removeServer(null as any, server)
      } catch (error) {
        logger.warn('Failed to remove server from MCPService:', error)
      }

      logger.info(`Deleted MCP server: ${server.name} (${serverId})`)
      this.emit('serverDeleted', server)
    } catch (error) {
      logger.error('Failed to delete server:', error)
      throw error
    }
  }

  async toggleServer(serverId: string): Promise<MCPServer> {
    try {
      logger.silly(`toggleServer called for ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Toggle active status
      const updatedServer: MCPServer = {
        ...server,
        isActive: !server.isActive
      }

      logger.silly(`Toggling server ${server.name} to ${updatedServer.isActive ? 'active' : 'inactive'}`)

      // Sync to Redux store (which handles persistence)
      await this.syncToRedux(updatedServer, 'update')

      // Handle session based on new status
      if (updatedServer.isActive) {
        try {
          await this.createServerSession(serverId)
        } catch (sessionError) {
          logger.warn(`Failed to create session for activated server ${serverId}:`, sessionError)
        }
      } else {
        try {
          await this.deleteServerSession(serverId)
        } catch (sessionError) {
          logger.warn(`Failed to delete session for deactivated server ${serverId}:`, sessionError)
        }
      }

      logger.info(`Toggled MCP server ${updatedServer.name}: ${updatedServer.isActive ? 'activated' : 'deactivated'}`)
      this.emit('serverToggled', updatedServer)

      return updatedServer
    } catch (error) {
      logger.error('Failed to toggle server:', error)
      throw error
    }
  }

  async toggleTool(serverName: string, toolName: string): Promise<ToolToggleResult> {
    try {
      logger.silly(`toggleTool called for server: ${serverName}, tool: ${toolName}`)

      // Find server by name
      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.name === serverName)
      if (!server) {
        throw new Error(`Server with name '${serverName}' not found`)
      }

      // Check if tool is currently disabled
      const disabledTools = server.disabledTools || []
      const isCurrentlyDisabled = disabledTools.includes(toolName)

      logger.silly(`Tool ${toolName} currently disabled: ${isCurrentlyDisabled}`)

      // Toggle tool status
      let updatedDisabledTools: string[]
      if (isCurrentlyDisabled) {
        // Enable tool (remove from disabled list)
        updatedDisabledTools = disabledTools.filter((tool) => tool !== toolName)
      } else {
        // Disable tool (add to disabled list)
        updatedDisabledTools = [...disabledTools, toolName]
      }

      // Update server
      const updatedServer: MCPServer = {
        ...server,
        disabledTools: updatedDisabledTools
      }

      await this.syncToRedux(updatedServer, 'update')

      const result: ToolToggleResult = {
        serverName,
        toolName,
        enabled: !isCurrentlyDisabled
      }

      logger.info(`Toggled tool ${toolName} for server ${serverName}: ${result.enabled ? 'enabled' : 'disabled'}`)
      this.emit('toolToggled', result)

      return result
    } catch (error) {
      logger.error('Failed to toggle tool:', error)
      throw error
    }
  }

  async getTools(serverId: string): Promise<any[]> {
    try {
      logger.silly(`getTools called for server ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Use MCPService to get tools
      const tools = await McpService.listTools(null as any, server)
      logger.silly(`Retrieved ${tools.length} tools for server: ${server.name}`)

      return tools
    } catch (error) {
      logger.error('Failed to get tools:', error)
      throw error
    }
  }

  async listTools(serverId: string): Promise<any[]> {
    try {
      logger.silly(`listTools called for server ID: ${serverId}`)
      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }
      const { tools } = (await session.client?.listTools()) || {}
      logger.silly(`Retrieved ${tools?.length || 0} tools for server: ${session.serverName}`)
      return tools || ([] as any)
    } catch (error) {
      logger.error('Failed to list tools:', error)
      throw error
    }
  }

  async listResources(serverId: string): Promise<any[]> {
    try {
      logger.silly(`listResources called for server ID: ${serverId}`)
      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }
      const { resources } = (await session.client?.listResources()) || {}
      logger.silly(`Retrieved ${resources?.length || 0} resources for server: ${session.serverName}`)
      return resources || ([] as any)
    } catch (error) {
      logger.error('Failed to list resources:', error)
      throw error
    }
  }

  async listPrompts(serverId: string): Promise<any[]> {
    try {
      logger.silly(`listPrompts called for server ID: ${serverId}`)
      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }
      const { prompts } = (await session.client?.listPrompts()) || {}
      logger.silly(`Retrieved ${prompts?.length || 0} prompts for server: ${session.serverName}`)
      return prompts || ([] as any)
    } catch (error) {
      logger.error('Failed to list prompts:', error)
      throw error
    }
  }

  async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    try {
      logger.silly(`callTool called for server ID: ${serverId}, tool: ${toolName}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }

      if (!session.isConnected || !session.client) {
        throw new Error(
          `Session for server '${server.name}' is not connected or client is unavailable. Connection status: ${session.isConnected}, Client: ${!!session.client}, Error: ${session.error}`
        )
      }

      const result = await session.client.callTool({ name: toolName, arguments: args })
      logger.info(`Called tool ${toolName} on server: ${server.name}`)

      return result
    } catch (error) {
      logger.error(`Failed to call tool ${toolName}:`, error)
      throw error
    }
  }

  async callToolWithStreaming(
    serverId: string,
    toolName: string,
    args: any,
    callId?: string,
    callbacks?: StreamingCallbacks
  ): Promise<any> {
    try {
      logger.silly(`callToolWithStreaming called for server ID: ${serverId}, tool: ${toolName}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // For now, wrap the existing callTool with progress simulation
      // In a full implementation, this would integrate with the MCP SDK's streaming capabilities
      let progressStep = 0
      const totalSteps = 3

      try {
        // Send initial progress
        if (callbacks?.onProgress) {
          await callbacks.onProgress({
            current: progressStep++,
            total: totalSteps,
            message: 'Initializing tool call...'
          })
        }

        // Send starting chunk
        if (callbacks?.onChunk) {
          await callbacks.onChunk({
            type: 'start',
            content: { serverName: server.name, toolName, args, callId }
          })
        }

        // Send progress update
        if (callbacks?.onProgress) {
          await callbacks.onProgress({
            current: progressStep++,
            total: totalSteps,
            message: 'Executing tool...'
          })
        }

        // Call the actual tool (this could be enhanced to support real streaming)
        const session = this.sessions.get(serverId)
        if (!session) {
          throw new Error(`No session found for server ID '${serverId}'`)
        }
        logger.debug(`Calling tool ${toolName} with arguments:`, args)
        const result = await session.client?.callTool({ name: toolName, arguments: args })

        // Send result chunk
        if (callbacks?.onChunk) {
          await callbacks.onChunk({
            type: 'result',
            content: result
          })
        }

        // Send completion progress
        if (callbacks?.onProgress) {
          await callbacks.onProgress({
            current: totalSteps,
            total: totalSteps,
            message: 'Tool execution completed'
          })
        }

        logger.info(`Called streaming tool ${toolName} on server: ${server.name}`)
        return result
      } catch (error) {
        if (callbacks?.onError) {
          await callbacks.onError(error instanceof Error ? error : new Error(String(error)))
        }
        throw error
      }
    } catch (error) {
      logger.error(`Failed to call streaming tool ${toolName}:`, error)
      throw error
    }
  }

  async getPrompts(serverId: string): Promise<any[]> {
    try {
      logger.silly(`getPrompts called for server ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Use MCPService to get prompts
      const prompts = await McpService.listPrompts(null as any, server)
      logger.silly(`Retrieved ${prompts.length} prompts for server: ${server.name}`)

      return prompts
    } catch (error) {
      logger.error('Failed to get prompts:', error)
      throw error
    }
  }

  async getPrompt(serverId: string, promptName: string, args?: any): Promise<any> {
    try {
      logger.silly(`getPrompt called for server ID: ${serverId}, prompt: ${promptName}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Use MCPService to get prompt
      const result = await McpService.getPrompt(null as any, { server, name: promptName, args })
      logger.info(`Retrieved prompt ${promptName} from server: ${server.name}`)

      return result
    } catch (error) {
      logger.error(`Failed to get prompt ${promptName}:`, error)
      throw error
    }
  }

  async getResources(serverId: string): Promise<any[]> {
    try {
      logger.silly(`getResources called for server ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Use MCPService to get resources
      const resources = await McpService.listResources(null as any, server)
      logger.silly(`Retrieved ${resources.length} resources for server: ${server.name}`)

      return resources
    } catch (error) {
      logger.error('Failed to get resources:', error)
      throw error
    }
  }

  async getResource(serverId: string, uri: string): Promise<any> {
    try {
      logger.silly(`getResource called for server ID: ${serverId}, URI: ${uri}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Use MCPService to get resource
      const result = await McpService.getResource(null as any, { server, uri })
      logger.info(`Retrieved resource ${uri} from server: ${server.name}`)

      return result
    } catch (error) {
      logger.error(`Failed to get resource ${uri}:`, error)
      throw error
    }
  }

  async getServerSession(serverId: string): Promise<MCPSession> {
    try {
      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }

      return session
    } catch (error) {
      logger.error('Failed to get server session:', error)
      throw error
    }
  }

  async createServerSession(serverId: string): Promise<MCPSession> {
    try {
      logger.silly(`createServerSession called for ID: ${serverId}`)

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (!server) {
        throw new Error(`Server with ID '${serverId}' not found`)
      }

      // Delete existing session if it exists
      if (this.sessions.has(serverId)) {
        await this.deleteServerSession(serverId)
      }

      // Create new session
      const session: MCPSession = {
        id: `session-${serverId}-${Date.now()}`,
        serverId,
        serverName: server.name,
        isConnected: false,
        connectionTime: new Date()
      }

      logger.silly(`Created session object for server: ${server.name}`)

      // Try to initialize client through MCPService
      try {
        const client = await McpService.initClient(server)
        session.client = client
        session.isConnected = true
        session.lastActivity = new Date()
        logger.info(`Created session for MCP server: ${server.name}`)
      } catch (connectionError) {
        session.isConnected = false
        session.error = connectionError instanceof Error ? connectionError.message : String(connectionError)
        logger.warn(`Failed to connect MCP server ${server.name}:`, connectionError)
      }

      // Store session
      this.sessions.set(serverId, session)
      this.emit('sessionCreated', session)

      return session
    } catch (error) {
      logger.error('Failed to create server session:', error)
      throw error
    }
  }

  async deleteServerSession(serverId: string): Promise<void> {
    try {
      logger.silly(`deleteServerSession called for ID: ${serverId}`)

      const session = this.sessions.get(serverId)
      if (!session) {
        throw new Error(`No session found for server ID '${serverId}'`)
      }

      const servers = await this.getServersFromRedux()
      const server = servers.find((s) => s.id === serverId)
      if (server) {
        try {
          await McpService.stopServer(null as any, server)
        } catch (stopError) {
          logger.warn(`Failed to stop MCP server ${server.name}:`, stopError)
        }
      }

      // Remove session
      this.sessions.delete(serverId)

      logger.info(`Deleted session for server: ${session.serverName}`)
      this.emit('sessionDeleted', session)
    } catch (error) {
      logger.error('Failed to delete server session:', error)
      throw error
    }
  }

  async restartServerSession(serverId: string): Promise<MCPSession> {
    try {
      await this.deleteServerSession(serverId)
      return await this.createServerSession(serverId)
    } catch (error) {
      logger.error('Failed to restart server session:', error)
      throw error
    }
  }

  private hasConfigurationChanged(oldServer: MCPServer, newServer: MCPServer): boolean {
    // Check if any configuration that affects connection has changed
    const configFields = ['type', 'baseUrl', 'command', 'args', 'env', 'headers', 'timeout']

    return configFields.some((field) => {
      const oldValue = oldServer[field as keyof MCPServer]
      const newValue = newServer[field as keyof MCPServer]
      return JSON.stringify(oldValue) !== JSON.stringify(newValue)
    })
  }

  // Utility methods for monitoring
  getAllSessions(): MCPSession[] {
    return Array.from(this.sessions.values())
  }

  getSessionsCount(): number {
    return this.sessions.size
  }

  getConnectedSessionsCount(): number {
    return Array.from(this.sessions.values()).filter((session) => session.isConnected).length
  }

  async healthCheck(): Promise<{ servers: number; sessions: number; connected: number }> {
    const servers = await this.getServersFromRedux()
    return {
      servers: servers.length,
      sessions: this.sessions.size,
      connected: this.getConnectedSessionsCount()
    }
  }
}

export const mcpApiService = new MCPApiService()
