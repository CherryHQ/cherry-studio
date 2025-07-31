import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AgentResponse,
  ApiServerConfig,
  CreateAgentInput,
  CreateSessionInput,
  CreateSessionLogInput,
  FetchMCPToolResponse,
  FetchModelResponse,
  ListAgentsOptions,
  ListResult,
  ListSessionLogsOptions,
  ListSessionsOptions,
  ServiceResult,
  SessionLogResponse,
  SessionResponse,
  SessionStatus,
  UpdateAgentInput,
  UpdateSessionInput
} from '@types'

const logger = loggerService.withContext('AgentManagementService')

/**
 * AgentManagementService - Service for managing agents, sessions, and session logs in the renderer process
 *
 * Features:
 * - Agent CRUD operations
 * - Session management
 * - Session log management
 * - Error handling and logging
 */
export class AgentManagementService {
  private static instance: AgentManagementService | null = null

  private constructor() {
    logger.info('AgentManagementService initialized')
  }

  public static getInstance(): AgentManagementService {
    if (!AgentManagementService.instance) {
      AgentManagementService.instance = new AgentManagementService()
    }
    return AgentManagementService.instance
  }

  // ========== AGENT OPERATIONS ==========

  /**
   * Create a new agent
   */
  public async createAgent(input: CreateAgentInput): Promise<ServiceResult<AgentResponse>> {
    try {
      logger.info('Creating agent', { name: input.name })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Agent_Create, input)
      if (result.success) {
        logger.info('Agent created successfully', { id: result.data?.id })
      } else {
        logger.error('Failed to create agent', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error creating agent', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Update an existing agent
   */
  public async updateAgent(input: UpdateAgentInput): Promise<ServiceResult<AgentResponse>> {
    try {
      logger.info('Updating agent', { id: input.id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Agent_Update, input)
      if (result.success) {
        logger.info('Agent updated successfully', { id: input.id })
      } else {
        logger.error('Failed to update agent', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error updating agent', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get agent by ID
   */
  public async getAgentById(id: string): Promise<ServiceResult<AgentResponse>> {
    try {
      logger.debug('Getting agent by ID', { id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Agent_GetById, id)
      if (!result.success) {
        logger.error('Failed to get agent', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error getting agent', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List all agents
   */
  public async listAgents(options?: ListAgentsOptions): Promise<ServiceResult<ListResult<AgentResponse>>> {
    try {
      logger.debug('Listing agents with options', { options })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Agent_List, options)
      if (result.success) {
        logger.debug(`Found ${result.data?.total || 0} agents`)
      } else {
        logger.error('Failed to list agents', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error listing agents', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete agent
   */
  public async deleteAgent(id: string): Promise<ServiceResult<void>> {
    try {
      logger.info('Deleting agent', { id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Agent_Delete, id)
      if (result.success) {
        logger.info('Agent deleted successfully', { id })
      } else {
        logger.error('Failed to delete agent', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error deleting agent', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ========== SESSION OPERATIONS ==========

  /**
   * Create a new session
   */
  public async createSession(input: CreateSessionInput): Promise<ServiceResult<SessionResponse>> {
    try {
      logger.info('Creating session for agents', { agent_ids: input.agent_ids })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_Create, input)
      if (result.success) {
        logger.info('Session created successfully', { id: result.data?.id })
      } else {
        logger.error('Failed to create session', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error creating session', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Update an existing session
   */
  public async updateSession(input: UpdateSessionInput): Promise<ServiceResult<SessionResponse>> {
    try {
      logger.info('Updating session', { id: input.id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_Update, input)
      if (result.success) {
        logger.info('Session updated successfully', { id: input.id })
      } else {
        logger.error('Failed to update session', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error updating session', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Update session status only
   */
  public async updateSessionStatus(id: string, status: SessionStatus): Promise<ServiceResult<void>> {
    try {
      logger.info('Updating session status', { id, status })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_UpdateStatus, id, status)
      if (result.success) {
        logger.info('Session status updated successfully', { id })
      } else {
        logger.error('Failed to update session status', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error updating session status', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get session by ID
   */
  public async getSessionById(id: string): Promise<ServiceResult<SessionResponse>> {
    try {
      logger.debug('Getting session by ID', { id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_GetById, id)
      if (!result.success) {
        logger.error('Failed to get session', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error getting session', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List sessions
   */
  public async listSessions(options?: ListSessionsOptions): Promise<ServiceResult<ListResult<SessionResponse>>> {
    try {
      logger.debug('Listing sessions with options', { options })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_List, options)
      if (result.success) {
        logger.debug(`Found ${result.data?.total || 0} sessions`)
      } else {
        logger.error('Failed to list sessions', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error listing sessions', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete session
   */
  public async deleteSession(id: string): Promise<ServiceResult<void>> {
    try {
      logger.info('Deleting session', { id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.Session_Delete, id)
      if (result.success) {
        logger.info('Session deleted successfully', { id })
      } else {
        logger.error('Failed to delete session', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error deleting session', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ========== SESSION LOG OPERATIONS ==========

  /**
   * Add log entry to session
   */
  public async addSessionLog(input: CreateSessionLogInput): Promise<ServiceResult<SessionLogResponse>> {
    try {
      logger.debug('Adding session log', { session_id: input.session_id, type: input.type })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.SessionLog_Add, input)
      if (!result.success) {
        logger.error('Failed to add session log', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error adding session log', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get session logs
   */
  public async getSessionLogs(options: ListSessionLogsOptions): Promise<ServiceResult<ListResult<SessionLogResponse>>> {
    try {
      logger.debug('Getting session logs for session', { session_id: options.session_id })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.SessionLog_GetBySessionId, options)
      if (result.success) {
        logger.debug(`Found ${result.data?.total || 0} session logs`)
      } else {
        logger.error('Failed to get session logs', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error getting session logs', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Clear all logs for a session
   */
  public async clearSessionLogs(sessionId: string): Promise<ServiceResult<void>> {
    try {
      logger.info('Clearing session logs for session', { sessionId })
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.SessionLog_ClearBySessionId, sessionId)
      if (result.success) {
        logger.info('Session logs cleared successfully', { sessionId })
      } else {
        logger.error('Failed to clear session logs', { error: result.error })
      }
      return result
    } catch (error) {
      logger.error('Error clearing session logs', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ========== API SERVER OPERATIONS ==========

  /**
   * Fetch available models from API server
   */
  public async fetchAvailableModels(apiServerConfig: ApiServerConfig): Promise<ServiceResult<FetchModelResponse[]>> {
    try {
      logger.info('Fetching available models from API server', {
        host: apiServerConfig.host,
        port: apiServerConfig.port
      })

      if (!apiServerConfig.enabled) {
        logger.warn('API server is not enabled')
        return {
          success: false,
          error: 'API server is not enabled'
        }
      }

      const url = `http://${apiServerConfig.host}:${apiServerConfig.port}/v1/models`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${apiServerConfig.apiKey}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Failed to fetch models from API server', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
        }
      }

      const data = await response.json()

      return {
        success: true,
        data: data.data
      }
    } catch (error) {
      logger.error('Error fetching models from API server', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Fetch available MCP tools from API server
   */
  public async fetchAvailableMCPTools(
    apiServerConfig: ApiServerConfig
  ): Promise<ServiceResult<FetchMCPToolResponse[]>> {
    try {
      logger.info('Fetching available MCP tools from API server', {
        host: apiServerConfig.host,
        port: apiServerConfig.port
      })

      if (!apiServerConfig.enabled) {
        logger.warn('API server is not enabled')
        return {
          success: false,
          error: 'API server is not enabled'
        }
      }

      const url = `http://${apiServerConfig.host}:${apiServerConfig.port}/v1/mcps`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${apiServerConfig.apiKey}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Failed to fetch MCP tools from API server', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
        }
      }

      const data = await response.json()
      logger.info('Successfully fetched MCP tools from API server', {
        serverCount: Object.keys(data.data || {}).length
      })

      return {
        success: true,
        data: data.data
      }
    } catch (error) {
      logger.error('Error fetching MCP tools from API server', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// Export singleton instance
export const agentManagementService = AgentManagementService.getInstance()
