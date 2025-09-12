import { Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type {
  AgentEntity,
  AgentSessionEntity,
  AgentType,
  PermissionMode,
  SessionLogEntity,
  SessionStatus
} from '@types'
import { app } from 'electron'
import path from 'path'

import { AgentQueries } from './db'

const logger = loggerService.withContext('AgentService')

export interface CreateAgentRequest {
  type: AgentType
  name: string
  description?: string
  avatar?: string
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number
}

export interface UpdateAgentRequest {
  name?: string
  description?: string
  avatar?: string
  instructions?: string
  model?: string
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number
}

export interface CreateSessionRequest {
  name?: string
  main_agent_id: string
  sub_agent_ids?: string[]
  user_goal?: string
  status?: SessionStatus
  external_session_id?: string
  model?: string
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number
}

export interface UpdateSessionRequest {
  name?: string
  main_agent_id?: string
  sub_agent_ids?: string[]
  user_goal?: string
  status?: SessionStatus
  external_session_id?: string
  model?: string
  plan_model?: string
  small_model?: string
  built_in_tools?: string[]
  mcps?: string[]
  knowledges?: string[]
  configuration?: Record<string, any>
  accessible_paths?: string[]
  permission_mode?: PermissionMode
  max_steps?: number
}

export interface CreateSessionLogRequest {
  session_id: string
  parent_id?: number
  role: 'user' | 'agent' | 'system' | 'tool'
  type: string
  content: Record<string, any>
  metadata?: Record<string, any>
}

export interface UpdateSessionLogRequest {
  content?: Record<string, any>
  metadata?: Record<string, any>
}

export interface ListOptions {
  limit?: number
  offset?: number
}

export interface ListSessionsOptions extends ListOptions {
  status?: SessionStatus
}

export class AgentService {
  private static instance: AgentService | null = null
  private db: Client | null = null
  private isInitialized = false

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'agents.db')

      logger.info(`Initializing Agent database at: ${dbPath}`)

      this.db = createClient({
        url: `file:${dbPath}`
      })

      // Create tables
      await this.db.execute(AgentQueries.createTables.agents)
      await this.db.execute(AgentQueries.createTables.sessions)
      await this.db.execute(AgentQueries.createTables.sessionLogs)

      // Create indexes
      const indexQueries = Object.values(AgentQueries.createIndexes)
      for (const query of indexQueries) {
        await this.db.execute(query)
      }

      this.isInitialized = true
      logger.info('Agent database initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize Agent database:', error as Error)
      throw error
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.db) {
      throw new Error('AgentService not initialized. Call initialize() first.')
    }
  }

  private serializeJsonFields(data: any): any {
    const serialized = { ...data }
    const jsonFields = ['built_in_tools', 'mcps', 'knowledges', 'configuration', 'accessible_paths', 'sub_agent_ids']

    for (const field of jsonFields) {
      if (serialized[field] !== undefined) {
        serialized[field] =
          Array.isArray(serialized[field]) || typeof serialized[field] === 'object'
            ? JSON.stringify(serialized[field])
            : serialized[field]
      }
    }

    return serialized
  }

  private deserializeJsonFields(data: any): any {
    if (!data) return data

    const deserialized = { ...data }
    const jsonFields = ['built_in_tools', 'mcps', 'knowledges', 'configuration', 'accessible_paths', 'sub_agent_ids']

    for (const field of jsonFields) {
      if (deserialized[field] && typeof deserialized[field] === 'string') {
        try {
          deserialized[field] = JSON.parse(deserialized[field])
        } catch (error) {
          logger.warn(`Failed to parse JSON field ${field}:`, error as Error)
        }
      }
    }

    return deserialized
  }

  // Agent Methods
  async createAgent(agentData: CreateAgentRequest): Promise<AgentEntity> {
    this.ensureInitialized()

    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    const serializedData = this.serializeJsonFields(agentData)

    const values = [
      id,
      serializedData.type,
      serializedData.name,
      serializedData.description || null,
      serializedData.avatar || null,
      serializedData.instructions || null,
      serializedData.model,
      serializedData.plan_model || null,
      serializedData.small_model || null,
      serializedData.built_in_tools || null,
      serializedData.mcps || null,
      serializedData.knowledges || null,
      serializedData.configuration || null,
      serializedData.accessible_paths || null,
      serializedData.permission_mode || 'readOnly',
      serializedData.max_steps || 10,
      now,
      now
    ]

    await this.db!.execute({
      sql: AgentQueries.agents.insert,
      args: values
    })

    const result = await this.db!.execute({
      sql: AgentQueries.agents.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      throw new Error('Failed to create agent')
    }

    return this.deserializeJsonFields(result.rows[0]) as AgentEntity
  }

  async getAgent(id: string): Promise<AgentEntity | null> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.agents.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeJsonFields(result.rows[0]) as AgentEntity
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const countResult = await this.db!.execute(AgentQueries.agents.count)
    const total = (countResult.rows[0] as any).total

    // Get agents with pagination
    let query = AgentQueries.agents.list
    const args: any[] = []

    if (options.limit !== undefined) {
      query += ' LIMIT ?'
      args.push(options.limit)

      if (options.offset !== undefined) {
        query += ' OFFSET ?'
        args.push(options.offset)
      }
    }

    const result = await this.db!.execute({
      sql: query,
      args: args
    })

    const agents = result.rows.map((row) => this.deserializeJsonFields(row)) as AgentEntity[]

    return { agents, total }
  }

  async updateAgent(id: string, updates: UpdateAgentRequest): Promise<AgentEntity | null> {
    this.ensureInitialized()

    // Check if agent exists
    const existing = await this.getAgent(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()
    const serializedUpdates = this.serializeJsonFields(updates)

    const values = [
      serializedUpdates.name !== undefined ? serializedUpdates.name : existing.name,
      serializedUpdates.description !== undefined ? serializedUpdates.description : existing.description,
      serializedUpdates.avatar !== undefined ? serializedUpdates.avatar : existing.avatar,
      serializedUpdates.instructions !== undefined ? serializedUpdates.instructions : existing.instructions,
      serializedUpdates.model !== undefined ? serializedUpdates.model : existing.model,
      serializedUpdates.plan_model !== undefined ? serializedUpdates.plan_model : existing.plan_model,
      serializedUpdates.small_model !== undefined ? serializedUpdates.small_model : existing.small_model,
      serializedUpdates.built_in_tools !== undefined
        ? serializedUpdates.built_in_tools
        : existing.built_in_tools
          ? JSON.stringify(existing.built_in_tools)
          : null,
      serializedUpdates.mcps !== undefined
        ? serializedUpdates.mcps
        : existing.mcps
          ? JSON.stringify(existing.mcps)
          : null,
      serializedUpdates.knowledges !== undefined
        ? serializedUpdates.knowledges
        : existing.knowledges
          ? JSON.stringify(existing.knowledges)
          : null,
      serializedUpdates.configuration !== undefined
        ? serializedUpdates.configuration
        : existing.configuration
          ? JSON.stringify(existing.configuration)
          : null,
      serializedUpdates.accessible_paths !== undefined
        ? serializedUpdates.accessible_paths
        : existing.accessible_paths
          ? JSON.stringify(existing.accessible_paths)
          : null,
      serializedUpdates.permission_mode !== undefined ? serializedUpdates.permission_mode : existing.permission_mode,
      serializedUpdates.max_steps !== undefined ? serializedUpdates.max_steps : existing.max_steps,
      now,
      id
    ]

    await this.db!.execute({
      sql: AgentQueries.agents.update,
      args: values
    })

    return await this.getAgent(id)
  }

  async deleteAgent(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.agents.delete,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async agentExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.agents.checkExists,
      args: [id]
    })

    return result.rows.length > 0
  }

  // Session Methods
  async createSession(sessionData: CreateSessionRequest): Promise<AgentSessionEntity> {
    this.ensureInitialized()

    // Validate agent exists
    const agentExists = await this.agentExists(sessionData.main_agent_id)
    if (!agentExists) {
      throw new Error(`Agent with id ${sessionData.main_agent_id} does not exist`)
    }

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    const serializedData = this.serializeJsonFields(sessionData)

    const values = [
      id,
      serializedData.name || null,
      serializedData.main_agent_id,
      serializedData.sub_agent_ids || null,
      serializedData.user_goal || null,
      serializedData.status || 'idle',
      serializedData.external_session_id || null,
      serializedData.model || null,
      serializedData.plan_model || null,
      serializedData.small_model || null,
      serializedData.built_in_tools || null,
      serializedData.mcps || null,
      serializedData.knowledges || null,
      serializedData.configuration || null,
      serializedData.accessible_paths || null,
      serializedData.permission_mode || 'readOnly',
      serializedData.max_steps || 10,
      now,
      now
    ]

    await this.db!.execute({
      sql: AgentQueries.sessions.insert,
      args: values
    })

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      throw new Error('Failed to create session')
    }

    return this.deserializeJsonFields(result.rows[0]) as AgentSessionEntity
  }

  async getSession(id: string): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeJsonFields(result.rows[0]) as AgentSessionEntity
  }

  async getSessionWithAgent(id: string): Promise<any | null> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.getSessionWithAgent,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeJsonFields(result.rows[0])
  }

  async listSessions(
    agentId?: string,
    options: ListSessionsOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
    this.ensureInitialized()

    let countQuery: string
    let listQuery: string
    const countArgs: any[] = []
    const listArgs: any[] = []

    // Build base queries
    if (agentId) {
      countQuery = 'SELECT COUNT(*) as total FROM sessions WHERE main_agent_id = ?'
      listQuery = 'SELECT * FROM sessions WHERE main_agent_id = ?'
      countArgs.push(agentId)
      listArgs.push(agentId)
    } else {
      countQuery = AgentQueries.sessions.count
      listQuery = AgentQueries.sessions.list
    }

    // Filter by status if specified
    if (options.status) {
      if (agentId) {
        countQuery += ' AND status = ?'
        listQuery += ' AND status = ?'
      } else {
        countQuery = 'SELECT COUNT(*) as total FROM sessions WHERE status = ?'
        listQuery = 'SELECT * FROM sessions WHERE status = ?'
      }
      countArgs.push(options.status)
      listArgs.push(options.status)
    }

    // Add ordering if not already present
    if (!listQuery.includes('ORDER BY')) {
      listQuery += ' ORDER BY created_at DESC'
    }

    // Get total count
    const countResult = await this.db!.execute({
      sql: countQuery,
      args: countArgs
    })
    const total = (countResult.rows[0] as any).total

    // Add pagination
    if (options.limit !== undefined) {
      listQuery += ' LIMIT ?'
      listArgs.push(options.limit)

      if (options.offset !== undefined) {
        listQuery += ' OFFSET ?'
        listArgs.push(options.offset)
      }
    }

    const result = await this.db!.execute({
      sql: listQuery,
      args: listArgs
    })

    const sessions = result.rows.map((row) => this.deserializeJsonFields(row)) as AgentSessionEntity[]

    return { sessions, total }
  }

  async updateSession(id: string, updates: UpdateSessionRequest): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    // Check if session exists
    const existing = await this.getSession(id)
    if (!existing) {
      return null
    }

    // Validate agent exists if changing main_agent_id
    if (updates.main_agent_id && updates.main_agent_id !== existing.main_agent_id) {
      const agentExists = await this.agentExists(updates.main_agent_id)
      if (!agentExists) {
        throw new Error(`Agent with id ${updates.main_agent_id} does not exist`)
      }
    }

    const now = new Date().toISOString()
    const serializedUpdates = this.serializeJsonFields(updates)

    const values = [
      serializedUpdates.name !== undefined ? serializedUpdates.name : existing.name,
      serializedUpdates.main_agent_id !== undefined ? serializedUpdates.main_agent_id : existing.main_agent_id,
      serializedUpdates.sub_agent_ids !== undefined
        ? serializedUpdates.sub_agent_ids
        : existing.sub_agent_ids
          ? JSON.stringify(existing.sub_agent_ids)
          : null,
      serializedUpdates.user_goal !== undefined ? serializedUpdates.user_goal : existing.user_goal,
      serializedUpdates.status !== undefined ? serializedUpdates.status : existing.status,
      serializedUpdates.external_session_id !== undefined
        ? serializedUpdates.external_session_id
        : existing.external_session_id,
      serializedUpdates.model !== undefined ? serializedUpdates.model : existing.model,
      serializedUpdates.plan_model !== undefined ? serializedUpdates.plan_model : existing.plan_model,
      serializedUpdates.small_model !== undefined ? serializedUpdates.small_model : existing.small_model,
      serializedUpdates.built_in_tools !== undefined
        ? serializedUpdates.built_in_tools
        : existing.built_in_tools
          ? JSON.stringify(existing.built_in_tools)
          : null,
      serializedUpdates.mcps !== undefined
        ? serializedUpdates.mcps
        : existing.mcps
          ? JSON.stringify(existing.mcps)
          : null,
      serializedUpdates.knowledges !== undefined
        ? serializedUpdates.knowledges
        : existing.knowledges
          ? JSON.stringify(existing.knowledges)
          : null,
      serializedUpdates.configuration !== undefined
        ? serializedUpdates.configuration
        : existing.configuration
          ? JSON.stringify(existing.configuration)
          : null,
      serializedUpdates.accessible_paths !== undefined
        ? serializedUpdates.accessible_paths
        : existing.accessible_paths
          ? JSON.stringify(existing.accessible_paths)
          : null,
      serializedUpdates.permission_mode !== undefined ? serializedUpdates.permission_mode : existing.permission_mode,
      serializedUpdates.max_steps !== undefined ? serializedUpdates.max_steps : existing.max_steps,
      now,
      id
    ]

    await this.db!.execute({
      sql: AgentQueries.sessions.update,
      args: values
    })

    return await this.getSession(id)
  }

  async updateSessionStatus(id: string, status: SessionStatus): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    const now = new Date().toISOString()

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.updateStatus,
      args: [status, now, id]
    })

    if (result.rowsAffected === 0) {
      return null
    }

    return await this.getSession(id)
  }

  async deleteSession(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.delete,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async sessionExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessions.checkExists,
      args: [id]
    })

    return result.rows.length > 0
  }

  // Session Log Methods
  async createSessionLog(logData: CreateSessionLogRequest): Promise<SessionLogEntity> {
    this.ensureInitialized()

    // Validate session exists
    const sessionExists = await this.sessionExists(logData.session_id)
    if (!sessionExists) {
      throw new Error(`Session with id ${logData.session_id} does not exist`)
    }

    // Validate parent exists if specified
    if (logData.parent_id) {
      const parentExists = await this.sessionLogExists(logData.parent_id)
      if (!parentExists) {
        throw new Error(`Parent log with id ${logData.parent_id} does not exist`)
      }
    }

    const now = new Date().toISOString()

    const values = [
      logData.session_id,
      logData.parent_id || null,
      logData.role,
      logData.type,
      JSON.stringify(logData.content),
      logData.metadata ? JSON.stringify(logData.metadata) : null,
      now,
      now
    ]

    const result = await this.db!.execute({
      sql: AgentQueries.sessionLogs.insert,
      args: values
    })

    if (!result.lastInsertRowid) {
      throw new Error('Failed to create session log')
    }

    const logResult = await this.db!.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [result.lastInsertRowid]
    })

    if (!logResult.rows[0]) {
      throw new Error('Failed to retrieve created session log')
    }

    return this.deserializeSessionLog(logResult.rows[0]) as SessionLogEntity
  }

  async getSessionLog(id: number): Promise<SessionLogEntity | null> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeSessionLog(result.rows[0]) as SessionLogEntity
  }

  async listSessionLogs(
    sessionId: string,
    options: ListOptions = {}
  ): Promise<{ logs: SessionLogEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const countResult = await this.db!.execute({
      sql: AgentQueries.sessionLogs.countBySessionId,
      args: [sessionId]
    })
    const total = (countResult.rows[0] as any).total

    // Get logs with pagination
    let query: string
    const args: any[] = [sessionId]

    if (options.limit !== undefined) {
      query = AgentQueries.sessionLogs.getBySessionIdWithPagination
      args.push(options.limit)

      if (options.offset !== undefined) {
        args.push(options.offset)
      } else {
        args.push(0)
      }
    } else {
      query = AgentQueries.sessionLogs.getBySessionId
    }

    const result = await this.db!.execute({
      sql: query,
      args: args
    })

    const logs = result.rows.map((row) => this.deserializeSessionLog(row)) as SessionLogEntity[]

    return { logs, total }
  }

  async updateSessionLog(id: number, updates: UpdateSessionLogRequest): Promise<SessionLogEntity | null> {
    this.ensureInitialized()

    // Check if log exists
    const existing = await this.getSessionLog(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    const values = [
      updates.content !== undefined ? JSON.stringify(updates.content) : JSON.stringify(existing.content),
      updates.metadata !== undefined
        ? updates.metadata
          ? JSON.stringify(updates.metadata)
          : null
        : existing.metadata
          ? JSON.stringify(existing.metadata)
          : null,
      now,
      id
    ]

    await this.db!.execute({
      sql: AgentQueries.sessionLogs.update,
      args: values
    })

    return await this.getSessionLog(id)
  }

  async deleteSessionLog(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessionLogs.deleteById,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async sessionLogExists(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.db!.execute({
      sql: AgentQueries.sessionLogs.getById,
      args: [id]
    })

    return result.rows.length > 0
  }

  async bulkCreateSessionLogs(logs: CreateSessionLogRequest[]): Promise<SessionLogEntity[]> {
    this.ensureInitialized()

    const results: SessionLogEntity[] = []

    // Use a transaction for bulk insert
    for (const logData of logs) {
      const result = await this.createSessionLog(logData)
      results.push(result)
    }

    return results
  }

  private deserializeSessionLog(data: any): SessionLogEntity {
    if (!data) return data

    const deserialized = { ...data }

    // Parse content JSON
    if (deserialized.content && typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn(`Failed to parse content JSON:`, error as Error)
      }
    }

    // Parse metadata JSON
    if (deserialized.metadata && typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON:`, error as Error)
      }
    }

    return deserialized
  }
}

export const agentService = AgentService.getInstance()
