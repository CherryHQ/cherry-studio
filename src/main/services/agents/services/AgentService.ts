import type { AgentEntity, AgentType, PermissionMode } from '@types'
import { count, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentRow, agentsTable, type InsertAgentRow } from '../database/schema'

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

export interface ListAgentsOptions {
  limit?: number
  offset?: number
}

export class AgentService extends BaseService {
  private static instance: AgentService | null = null

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
  }

  async initialize(): Promise<void> {
    await BaseService.initialize()
  }

  // Agent Methods
  async createAgent(agentData: CreateAgentRequest): Promise<AgentEntity> {
    this.ensureInitialized()

    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    const serializedData = this.serializeJsonFields(agentData)

    const insertData: InsertAgentRow = {
      id,
      type: serializedData.type,
      name: serializedData.name,
      description: serializedData.description || null,
      avatar: serializedData.avatar || null,
      instructions: serializedData.instructions || null,
      model: serializedData.model,
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

    await this.database.insert(agentsTable).values(insertData)

    const result = await this.database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)

    if (!result[0]) {
      throw new Error('Failed to create agent')
    }

    return this.deserializeJsonFields(result[0]) as AgentEntity
  }

  async getAgent(id: string): Promise<AgentEntity | null> {
    this.ensureInitialized()

    const result = await this.database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    return this.deserializeJsonFields(result[0]) as AgentEntity
  }

  async listAgents(options: ListAgentsOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const totalResult = await this.database.select({ count: count() }).from(agentsTable)

    const total = totalResult[0].count

    // Build query with pagination
    const baseQuery = this.database.select().from(agentsTable).orderBy(agentsTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => this.deserializeJsonFields(row)) as AgentEntity[]

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

    const updateData: Partial<AgentRow> = {
      updated_at: now
    }

    // Only update fields that are provided
    if (serializedUpdates.name !== undefined) updateData.name = serializedUpdates.name
    if (serializedUpdates.description !== undefined) updateData.description = serializedUpdates.description
    if (serializedUpdates.avatar !== undefined) updateData.avatar = serializedUpdates.avatar
    if (serializedUpdates.instructions !== undefined) updateData.instructions = serializedUpdates.instructions
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

    await this.database.update(agentsTable).set(updateData).where(eq(agentsTable.id, id))

    return await this.getAgent(id)
  }

  async deleteAgent(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.delete(agentsTable).where(eq(agentsTable.id, id))

    return result.rowsAffected > 0
  }

  async agentExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, id))
      .limit(1)

    return result.length > 0
  }
}

export const agentService = AgentService.getInstance()
