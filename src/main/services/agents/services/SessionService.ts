import type { AgentSessionEntity, SessionStatus } from '@types'
import { and, count, eq, type SQL } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type InsertSessionRow, type SessionRow, sessionsTable } from '../database/schema'

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

    const insertData: InsertSessionRow = {
      id,
      name: serializedData.name || null,
      main_agent_id: serializedData.main_agent_id,
      sub_agent_ids: serializedData.sub_agent_ids || null,
      user_goal: serializedData.user_goal || null,
      status: serializedData.status || 'idle',
      external_session_id: serializedData.external_session_id || null,
      model: serializedData.model || null,
      plan_model: serializedData.plan_model || null,
      small_model: serializedData.small_model || null,
      built_in_tools: serializedData.built_in_tools || null,
      mcps: serializedData.mcps || null,
      knowledges: serializedData.knowledges || null,
      configuration: serializedData.configuration || null,
      accessible_paths: serializedData.accessible_paths || null,
      permission_mode: serializedData.permission_mode || 'readOnly',
      max_steps: serializedData.max_steps || 10,
      created_at: now,
      updated_at: now
    }

    await this.database.insert(sessionsTable).values(insertData)

    const result = await this.database.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      throw new Error('Failed to create session')
    }

    return this.deserializeJsonFields(result[0]) as AgentSessionEntity
  }

  async getSession(id: string): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    const result = await this.database.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    return this.deserializeJsonFields(result[0]) as AgentSessionEntity
  }

  async getSessionWithAgent(id: string): Promise<any | null> {
    this.ensureInitialized()

    // TODO: Implement join query with agents table when needed
    // For now, just return the session
    return await this.getSession(id)
  }

  async listSessions(
    agentId?: string,
    options: ListSessionsOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
    this.ensureInitialized()

    // Build where conditions
    const whereConditions: SQL[] = []
    if (agentId) {
      whereConditions.push(eq(sessionsTable.main_agent_id, agentId))
    }
    if (options.status) {
      whereConditions.push(eq(sessionsTable.status, options.status))
    }

    const whereClause =
      whereConditions.length > 1
        ? and(...whereConditions)
        : whereConditions.length === 1
          ? whereConditions[0]
          : undefined

    // Get total count
    const totalResult = await this.database.select({ count: count() }).from(sessionsTable).where(whereClause)

    const total = totalResult[0].count

    // Build list query with pagination
    const baseQuery = this.database.select().from(sessionsTable).where(whereClause).orderBy(sessionsTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const sessions = result.map((row) => this.deserializeJsonFields(row)) as AgentSessionEntity[]

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

    const updateData: Partial<SessionRow> = {
      updated_at: now
    }

    // Only update fields that are provided
    if (serializedUpdates.name !== undefined) updateData.name = serializedUpdates.name
    if (serializedUpdates.main_agent_id !== undefined) updateData.main_agent_id = serializedUpdates.main_agent_id
    if (serializedUpdates.sub_agent_ids !== undefined) updateData.sub_agent_ids = serializedUpdates.sub_agent_ids
    if (serializedUpdates.user_goal !== undefined) updateData.user_goal = serializedUpdates.user_goal
    if (serializedUpdates.status !== undefined) updateData.status = serializedUpdates.status
    if (serializedUpdates.external_session_id !== undefined)
      updateData.external_session_id = serializedUpdates.external_session_id
    if (serializedUpdates.model !== undefined) updateData.model = serializedUpdates.model
    if (serializedUpdates.plan_model !== undefined) updateData.plan_model = serializedUpdates.plan_model
    if (serializedUpdates.small_model !== undefined) updateData.small_model = serializedUpdates.small_model
    if (serializedUpdates.built_in_tools !== undefined) updateData.built_in_tools = serializedUpdates.built_in_tools
    if (serializedUpdates.mcps !== undefined) updateData.mcps = serializedUpdates.mcps
    if (serializedUpdates.knowledges !== undefined) updateData.knowledges = serializedUpdates.knowledges
    if (serializedUpdates.configuration !== undefined) updateData.configuration = serializedUpdates.configuration
    if (serializedUpdates.accessible_paths !== undefined)
      updateData.accessible_paths = serializedUpdates.accessible_paths
    if (serializedUpdates.permission_mode !== undefined) updateData.permission_mode = serializedUpdates.permission_mode
    if (serializedUpdates.max_steps !== undefined) updateData.max_steps = serializedUpdates.max_steps

    await this.database.update(sessionsTable).set(updateData).where(eq(sessionsTable.id, id))

    return await this.getSession(id)
  }

  async updateSessionStatus(id: string, status: SessionStatus): Promise<AgentSessionEntity | null> {
    this.ensureInitialized()

    const now = new Date().toISOString()

    const result = await this.database
      .update(sessionsTable)
      .set({ status, updated_at: now })
      .where(eq(sessionsTable.id, id))

    if (result.rowsAffected === 0) {
      return null
    }

    return await this.getSession(id)
  }

  async deleteSession(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.delete(sessionsTable).where(eq(sessionsTable.id, id))

    return result.rowsAffected > 0
  }

  async sessionExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1)

    return result.length > 0
  }
}

export const sessionService = SessionService.getInstance()
