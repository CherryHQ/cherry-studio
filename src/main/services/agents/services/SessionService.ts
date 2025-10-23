import type {
  AgentEntity,
  AgentSessionEntity,
  CreateSessionRequest,
  GetAgentSessionResponse,
  ListOptions,
  UpdateSessionRequest,
  UpdateSessionResponse
} from '@types'
import { AgentBaseSchema } from '@types'
import { and, count, desc, eq, type SQL } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { agentsTable, type InsertSessionRow, type SessionRow, sessionsTable } from '../database/schema'
import type { AgentModelField } from '../errors'

export class SessionService extends BaseService {
  private static instance: SessionService | null = null
  private readonly modelFields: AgentModelField[] = ['model', 'plan_model', 'small_model']

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService()
    }
    return SessionService.instance
  }

  async initialize(): Promise<void> {
    await BaseService.initialize()
  }

  async createSession(
    agentId: string,
    req: Partial<CreateSessionRequest> = {}
  ): Promise<GetAgentSessionResponse | null> {
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

    await this.validateAgentModels(agent.type, {
      model: sessionData.model,
      plan_model: sessionData.plan_model,
      small_model: sessionData.small_model
    })

    if (sessionData.accessible_paths !== undefined) {
      sessionData.accessible_paths = this.ensurePathsExist(sessionData.accessible_paths)
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

    const session = this.deserializeJsonFields(result[0])
    return await this.getSession(agentId, session.id)
  }

  async getSession(agentId: string, id: string): Promise<GetAgentSessionResponse | null> {
    this.ensureInitialized()

    const result = await this.database
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
      .limit(1)

    if (!result[0]) {
      return null
    }

    const session = this.deserializeJsonFields(result[0]) as GetAgentSessionResponse
    session.tools = await this.listMcpTools(session.agent_type, session.mcps)
    session.slash_commands = await this.listSlashCommands(session.agent_type)
    return session
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

    // Build list query with pagination - sort by updated_at descending (latest first)
    const baseQuery = this.database
      .select()
      .from(sessionsTable)
      .where(whereClause)
      .orderBy(desc(sessionsTable.updated_at))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const sessions = result.map((row) => this.deserializeJsonFields(row)) as GetAgentSessionResponse[]

    return { sessions, total }
  }

  async updateSession(
    agentId: string,
    id: string,
    updates: UpdateSessionRequest
  ): Promise<UpdateSessionResponse | null> {
    this.ensureInitialized()

    // Check if session exists
    const existing = await this.getSession(agentId, id)
    if (!existing) {
      return null
    }

    // Validate agent exists if changing main_agent_id
    // We'll skip this validation for now to avoid circular dependencies

    const now = new Date().toISOString()

    if (updates.accessible_paths !== undefined) {
      updates.accessible_paths = this.ensurePathsExist(updates.accessible_paths)
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        modelUpdates[field] = updates[field as keyof UpdateSessionRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      await this.validateAgentModels(existing.agent_type, modelUpdates)
    }

    const serializedUpdates = this.serializeJsonFields(updates)

    const updateData: Partial<SessionRow> = {
      updated_at: now
    }
    const replaceableFields = Object.keys(AgentBaseSchema.shape) as (keyof SessionRow)[]

    for (const field of replaceableFields) {
      if (Object.prototype.hasOwnProperty.call(serializedUpdates, field)) {
        const value = serializedUpdates[field as keyof typeof serializedUpdates]
        ;(updateData as Record<string, unknown>)[field] = value ?? null
      }
    }

    await this.database.update(sessionsTable).set(updateData).where(eq(sessionsTable.id, id))

    return await this.getSession(agentId, id)
  }

  async deleteSession(agentId: string, id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))

    return result.rowsAffected > 0
  }

  async sessionExists(agentId: string, id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agent_id, agentId)))
      .limit(1)

    return result.length > 0
  }
}

export const sessionService = SessionService.getInstance()
