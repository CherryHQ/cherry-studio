import { Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type {
  AgentResponse,
  CreateAgentInput,
  CreateSessionInput,
  CreateSessionLogInput,
  ListAgentsOptions,
  ListResult,
  ListSessionLogsOptions,
  ListSessionsOptions,
  ServiceResult,
  SessionLogResponse,
  SessionResponse,
  UpdateAgentInput,
  UpdateSessionInput
} from '@types'
import crypto from 'crypto'
import { app } from 'electron'
import path from 'path'

import { AgentQueries } from './queries'

const logger = loggerService.withContext('AgentService')

export class AgentService {
  private static instance: AgentService | null = null
  private db: Client | null = null
  private isInitialized = false

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
  }

  public static reload(): AgentService {
    if (AgentService.instance) {
      AgentService.instance.close()
    }
    AgentService.instance = new AgentService()
    return AgentService.instance
  }

  /**
   * Initialize the database connection and create tables
   */
  private async init(): Promise<void> {
    if (this.isInitialized && this.db) {
      return
    }

    try {
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'agent.db')

      this.db = createClient({
        url: `file:${dbPath}`,
        intMode: 'number'
      })

      // Create tables
      await this.createTables()
      this.isInitialized = true
      logger.debug('Agent database initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize agent database:', error as Error)
      throw new Error(
        `Agent database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Create all tables
    await this.db.execute(AgentQueries.createTables.agents)
    await this.db.execute(AgentQueries.createTables.sessions)
    await this.db.execute(AgentQueries.createTables.sessionLogs)

    // Create indexes
    await this.db.execute(AgentQueries.createIndexes.agentsName)
    await this.db.execute(AgentQueries.createIndexes.agentsModel)
    await this.db.execute(AgentQueries.createIndexes.agentsCreatedAt)
    await this.db.execute(AgentQueries.createIndexes.agentsIsDeleted)

    await this.db.execute(AgentQueries.createIndexes.sessionsStatus)
    await this.db.execute(AgentQueries.createIndexes.sessionsCreatedAt)
    await this.db.execute(AgentQueries.createIndexes.sessionsIsDeleted)

    await this.db.execute(AgentQueries.createIndexes.sessionLogsSessionId)
    await this.db.execute(AgentQueries.createIndexes.sessionLogsParentId)
    await this.db.execute(AgentQueries.createIndexes.sessionLogsRole)
    await this.db.execute(AgentQueries.createIndexes.sessionLogsType)
    await this.db.execute(AgentQueries.createIndexes.sessionLogsCreatedAt)
  }

  // ========== AGENT OPERATIONS ==========

  /**
   * Create a new agent
   */
  public async createAgent(input: CreateAgentInput): Promise<ServiceResult<AgentResponse>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      await this.db.execute({
        sql: AgentQueries.agents.insert,
        args: [
          id,
          input.name,
          input.description || null,
          input.avatar || null,
          input.instructions || null,
          input.model,
          input.tools ? JSON.stringify(input.tools) : null,
          input.knowledges ? JSON.stringify(input.knowledges) : null,
          input.configuration ? JSON.stringify(input.configuration) : null,
          now,
          now
        ]
      })

      const agent = await this.getAgentById(id)
      if (!agent.success || !agent.data) {
        throw new Error('Failed to retrieve created agent')
      }

      logger.debug(`Agent created: ${id}`)
      return { success: true, data: agent.data }
    } catch (error) {
      logger.error('Failed to create agent:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      // Check if agent exists
      const existing = await this.db.execute({
        sql: AgentQueries.agents.checkExists,
        args: [input.id]
      })

      if (existing.rows.length === 0) {
        return { success: false, error: 'Agent not found' }
      }

      // Get current agent data
      const current = await this.getAgentById(input.id)
      if (!current.success || !current.data) {
        return { success: false, error: 'Agent not found' }
      }

      const currentAgent = current.data
      const now = new Date().toISOString()

      // Update with provided values or keep existing ones
      await this.db.execute({
        sql: AgentQueries.agents.update,
        args: [
          input.name ?? currentAgent.name,
          input.description ?? currentAgent.description ?? null,
          input.avatar ?? currentAgent.avatar ?? null,
          input.instructions ?? currentAgent.instructions ?? null,
          input.model ?? currentAgent.model,
          input.tools ? JSON.stringify(input.tools) : JSON.stringify(currentAgent.tools),
          input.knowledges ? JSON.stringify(input.knowledges) : JSON.stringify(currentAgent.knowledges),
          input.configuration ? JSON.stringify(input.configuration) : JSON.stringify(currentAgent.configuration),
          now,
          input.id
        ]
      })

      const updatedAgent = await this.getAgentById(input.id)
      if (!updatedAgent.success || !updatedAgent.data) {
        throw new Error('Failed to retrieve updated agent')
      }

      logger.debug(`Agent updated: ${input.id}`)
      return { success: true, data: updatedAgent.data }
    } catch (error) {
      logger.error('Failed to update agent:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const result = await this.db.execute({
        sql: AgentQueries.agents.getById,
        args: [id]
      })

      if (result.rows.length === 0) {
        return { success: false, error: 'Agent not found' }
      }

      const row = result.rows[0] as any
      const agent: AgentResponse = {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        avatar: row.avatar as string,
        instructions: row.instructions as string,
        model: row.model as string,
        tools: row.tools ? JSON.parse(row.tools as string) : [],
        knowledges: row.knowledges ? JSON.parse(row.knowledges as string) : [],
        configuration: row.configuration ? JSON.parse(row.configuration as string) : {},
        created_at: row.created_at as string,
        updated_at: row.updated_at as string
      }

      return { success: true, data: agent }
    } catch (error) {
      logger.error('Failed to get agent:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List all agents
   */
  public async listAgents(options: ListAgentsOptions = {}): Promise<ServiceResult<ListResult<AgentResponse>>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const { limit = 100, offset = 0 } = options

      // Get total count
      const countResult = await this.db.execute({
        sql: AgentQueries.agents.count,
        args: []
      })
      const total = (countResult.rows[0] as any).total as number

      // Get agents with pagination
      const result = await this.db.execute({
        sql: `${AgentQueries.agents.list} LIMIT ? OFFSET ?`,
        args: [limit, offset]
      })

      const agents: AgentResponse[] = result.rows.map((row: any) => ({
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        avatar: row.avatar as string,
        instructions: row.instructions as string,
        model: row.model as string,
        tools: row.tools ? JSON.parse(row.tools as string) : [],
        knowledges: row.knowledges ? JSON.parse(row.knowledges as string) : [],
        configuration: row.configuration ? JSON.parse(row.configuration as string) : {},
        created_at: row.created_at as string,
        updated_at: row.updated_at as string
      }))

      return {
        success: true,
        data: { items: agents, total }
      }
    } catch (error) {
      logger.error('Failed to list agents:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete agent (soft delete)
   */
  public async deleteAgent(id: string): Promise<ServiceResult<void>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const existing = await this.db.execute({
        sql: AgentQueries.agents.checkExists,
        args: [id]
      })

      if (existing.rows.length === 0) {
        return { success: false, error: 'Agent not found' }
      }

      await this.db.execute({
        sql: AgentQueries.agents.softDelete,
        args: [new Date().toISOString(), id]
      })

      logger.debug(`Agent deleted: ${id}`)
      return { success: true }
    } catch (error) {
      logger.error('Failed to delete agent:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      await this.db.execute({
        sql: AgentQueries.sessions.insert,
        args: [
          id,
          JSON.stringify(input.agent_ids),
          input.user_prompt || null,
          input.status || 'idle',
          input.accessible_paths ? JSON.stringify(input.accessible_paths) : null,
          now,
          now
        ]
      })

      const session = await this.getSessionById(id)
      if (!session.success || !session.data) {
        throw new Error('Failed to retrieve created session')
      }

      logger.debug(`Session created: ${id}`)
      return { success: true, data: session.data }
    } catch (error) {
      logger.error('Failed to create session:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Update session
   */
  public async updateSession(input: UpdateSessionInput): Promise<ServiceResult<SessionResponse>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const existing = await this.db.execute({
        sql: AgentQueries.sessions.checkExists,
        args: [input.id]
      })

      if (existing.rows.length === 0) {
        return { success: false, error: 'Session not found' }
      }

      // Get current session data
      const current = await this.getSessionById(input.id)
      if (!current.success || !current.data) {
        return { success: false, error: 'Session not found' }
      }

      const currentSession = current.data
      const now = new Date().toISOString()

      await this.db.execute({
        sql: AgentQueries.sessions.update,
        args: [
          input.agent_ids ? JSON.stringify(input.agent_ids) : JSON.stringify(currentSession.agent_ids),
          input.user_prompt ?? currentSession.user_prompt ?? null,
          input.status ?? currentSession.status,
          input.accessible_paths
            ? JSON.stringify(input.accessible_paths)
            : JSON.stringify(currentSession.accessible_paths),
          now,
          input.id
        ]
      })

      const updatedSession = await this.getSessionById(input.id)
      if (!updatedSession.success || !updatedSession.data) {
        throw new Error('Failed to retrieve updated session')
      }

      logger.debug(`Session updated: ${input.id}`)
      return { success: true, data: updatedSession.data }
    } catch (error) {
      logger.error('Failed to update session:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Update session status only
   */
  public async updateSessionStatus(
    id: string,
    status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  ): Promise<ServiceResult<void>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const existing = await this.db.execute({
        sql: AgentQueries.sessions.checkExists,
        args: [id]
      })

      if (existing.rows.length === 0) {
        return { success: false, error: 'Session not found' }
      }

      await this.db.execute({
        sql: AgentQueries.sessions.updateStatus,
        args: [status, new Date().toISOString(), id]
      })

      logger.debug(`Session status updated: ${id} -> ${status}`)
      return { success: true }
    } catch (error) {
      logger.error('Failed to update session status:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const result = await this.db.execute({
        sql: AgentQueries.sessions.getById,
        args: [id]
      })

      if (result.rows.length === 0) {
        return { success: false, error: 'Session not found' }
      }

      const row = result.rows[0] as any
      const session: SessionResponse = {
        id: row.id as string,
        agent_ids: JSON.parse(row.agent_ids as string),
        user_prompt: row.user_prompt as string,
        status: row.status as any,
        accessible_paths: row.accessible_paths ? JSON.parse(row.accessible_paths as string) : [],
        created_at: row.created_at as string,
        updated_at: row.updated_at as string
      }

      return { success: true, data: session }
    } catch (error) {
      logger.error('Failed to get session:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List sessions
   */
  public async listSessions(options: ListSessionsOptions = {}): Promise<ServiceResult<ListResult<SessionResponse>>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const { limit = 100, offset = 0, status } = options

      let query: string
      const args: any[] = []

      if (status) {
        query = AgentQueries.sessions.getByStatus
        args.push(status)
      } else {
        query = AgentQueries.sessions.list
      }

      // Get total count
      const countResult = await this.db.execute({
        sql: AgentQueries.sessions.count,
        args: []
      })
      const total = (countResult.rows[0] as any).total as number

      // Get sessions with pagination
      args.push(limit, offset)
      const result = await this.db.execute({
        sql: `${query} LIMIT ? OFFSET ?`,
        args
      })

      const sessions: SessionResponse[] = result.rows.map((row: any) => ({
        id: row.id as string,
        agent_ids: JSON.parse(row.agent_ids as string),
        user_prompt: row.user_prompt as string,
        status: row.status as any,
        accessible_paths: row.accessible_paths ? JSON.parse(row.accessible_paths as string) : [],
        created_at: row.created_at as string,
        updated_at: row.updated_at as string
      }))

      return {
        success: true,
        data: { items: sessions, total }
      }
    } catch (error) {
      logger.error('Failed to list sessions:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete session (soft delete)
   */
  public async deleteSession(id: string): Promise<ServiceResult<void>> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const existing = await this.db.execute({
        sql: AgentQueries.sessions.checkExists,
        args: [id]
      })

      if (existing.rows.length === 0) {
        return { success: false, error: 'Session not found' }
      }

      await this.db.execute({
        sql: AgentQueries.sessions.softDelete,
        args: [new Date().toISOString(), id]
      })

      logger.debug(`Session deleted: ${id}`)
      return { success: true }
    } catch (error) {
      logger.error('Failed to delete session:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const now = new Date().toISOString()

      const result = await this.db.execute({
        sql: AgentQueries.sessionLogs.insert,
        args: [input.session_id, input.parent_id || null, input.role, input.type, JSON.stringify(input.content), now]
      })

      const logId = Number(result.lastInsertRowid)
      const log: SessionLogResponse = {
        id: logId,
        session_id: input.session_id,
        parent_id: input.parent_id,
        role: input.role,
        type: input.type,
        content: input.content,
        created_at: now
      }

      logger.debug(`Session log added: ${logId} for session ${input.session_id}`)
      return { success: true, data: log }
    } catch (error) {
      logger.error('Failed to add session log:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const { session_id, limit = 1000, offset = 0 } = options

      // Get total count
      const countResult = await this.db.execute({
        sql: AgentQueries.sessionLogs.countBySessionId,
        args: [session_id]
      })
      const total = (countResult.rows[0] as any).total as number

      // Get logs with pagination
      const result = await this.db.execute({
        sql: AgentQueries.sessionLogs.getBySessionIdWithPagination,
        args: [session_id, limit, offset]
      })

      const logs: SessionLogResponse[] = result.rows.map((row: any) => ({
        id: row.id as number,
        session_id: row.session_id as string,
        parent_id: row.parent_id as number,
        role: row.role as any,
        type: row.type as any,
        content: JSON.parse(row.content as string),
        created_at: row.created_at as string
      }))

      return {
        success: true,
        data: { items: logs, total }
      }
    } catch (error) {
      logger.error('Failed to get session logs:', error as Error)
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
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      await this.db.execute({
        sql: AgentQueries.sessionLogs.deleteBySessionId,
        args: [sessionId]
      })

      logger.debug(`Session logs cleared for session: ${sessionId}`)
      return { success: true }
    } catch (error) {
      logger.error('Failed to clear session logs:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Close database connection
   */
  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
      this.isInitialized = false
    }
  }
}

export default AgentService
