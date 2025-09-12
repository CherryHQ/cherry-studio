import type { AgentSessionEntity, SessionStatus } from '@types'

import { BaseService } from '../BaseService'
import { AgentQueries_Legacy as AgentQueries } from '../database'

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
  permission_mode?: 'readOnly' | 'acceptEdits' | 'bypassPermissions'
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
  permission_mode?: 'readOnly' | 'acceptEdits' | 'bypassPermissions'
  max_steps?: number
}

export interface ListSessionsOptions {
  limit?: number
  offset?: number
  status?: SessionStatus
}

export class SessionService extends BaseService {
  private static instance: SessionService | null = null

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService()
    }
    return SessionService.instance
  }

  async initialize(): Promise<void> {
    await BaseService.initialize()
  }

  async createSession(sessionData: CreateSessionRequest): Promise<AgentSessionEntity> {
    this.ensureInitialized()

    // Validate agent exists - we'll need to import AgentService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

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

    await this.database.execute({
      sql: AgentQueries.sessions.insert,
      args: values
    })

    const result = await this.database.execute({
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

    const result = await this.database.execute({
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

    const result = await this.database.execute({
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
    const countResult = await this.database.execute({
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

    const result = await this.database.execute({
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
    // We'll skip this validation for now to avoid circular dependencies

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

    await this.database.execute({
      sql: AgentQueries.sessions.update,
      args: values
    })

    return await this.getSession(id)
  }

  async updateSessionStatus(id: string, status: SessionStatus): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    const now = new Date().toISOString()

    const result = await this.database.execute({
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

    const result = await this.database.execute({
      sql: AgentQueries.sessions.delete,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async sessionExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessions.checkExists,
      args: [id]
    })

    return result.rows.length > 0
  }
}

export const sessionService = SessionService.getInstance()
