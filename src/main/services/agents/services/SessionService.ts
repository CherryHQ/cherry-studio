import type {
  AgentEntity,
  AgentSessionEntity,
  CreateSessionRequest,
  GetAgentSessionResponse,
  ListOptions,
  UpdateSessionRequest
} from '@types'
import { and, count, eq, type SQL } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { agentsTable, type InsertSessionRow, type SessionRow, sessionsTable } from '../database/schema'

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

  async createSession(agentId: string, req: CreateSessionRequest): Promise<AgentSessionEntity> {
    this.ensureInitialized()

    // Validate agent exists - we'll need to import AgentService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

    const agents = await this.database.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1)
    if (!agents[0]) {
      throw new Error('Agent not found')
    }
    const agent = this.deserializeJsonFields(agents[0]) as AgentEntity

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    // inherit configuration from agent by default, can be overridden by sessionData
    const sessionData: Partial<CreateSessionRequest> = {
      ...agent,
      ...req
    }

    const serializedData = this.serializeJsonFields(sessionData)

    const insertData: InsertSessionRow = {
      id,
      agent_id: agentId,
      agent_type: agent.type,
      name: serializedData.name || null,
      description: serializedData.description || null,
      accessible_paths: serializedData.accessible_paths || null,
      instructions: serializedData.instructions || null,
      model: serializedData.model || null,
      plan_model: serializedData.plan_model || null,
      small_model: serializedData.small_model || null,
      mcps: serializedData.mcps || null,
      configuration: serializedData.configuration || null,
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

  async getSession(id: string): Promise<GetAgentSessionResponse | null> {
    this.ensureInitialized()

    const result = await this.database.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    const session = this.deserializeJsonFields(result[0]) as GetAgentSessionResponse

    return session
  }

  async getSessionWithAgent(id: string): Promise<any | null> {
    this.ensureInitialized()

    // TODO: Implement join query with agents table when needed
    // For now, just return the session
    return await this.getSession(id)
  }

  async listSessions(
    agentId?: string,
    options: ListOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
    this.ensureInitialized()

    // Build where conditions
    const whereConditions: SQL[] = []
    if (agentId) {
      whereConditions.push(eq(sessionsTable.agent_id, agentId))
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

    const sessions = result.map((row) => this.deserializeJsonFields(row)) as GetAgentSessionResponse[]

    return { sessions, total }
  }

  async updateSession(id: string, updates: UpdateSessionRequest): Promise<GetAgentSessionResponse | null> {
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

    if (serializedUpdates.model !== undefined) updateData.model = serializedUpdates.model
    if (serializedUpdates.plan_model !== undefined) updateData.plan_model = serializedUpdates.plan_model
    if (serializedUpdates.small_model !== undefined) updateData.small_model = serializedUpdates.small_model

    if (serializedUpdates.mcps !== undefined) updateData.mcps = serializedUpdates.mcps

    if (serializedUpdates.configuration !== undefined) updateData.configuration = serializedUpdates.configuration
    if (serializedUpdates.accessible_paths !== undefined)
      updateData.accessible_paths = serializedUpdates.accessible_paths

    await this.database.update(sessionsTable).set(updateData).where(eq(sessionsTable.id, id))

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
