import path from 'node:path'

import { getDataPath } from '@main/utils'
import type { AgentEntity, CreateAgentRequest, GetAgentResponse, ListOptions, UpdateAgentRequest } from '@types'
import { count, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentRow, agentsTable, type InsertAgentRow } from '../database/schema'
import { builtinTools } from './claudecode/tools'

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
  async createAgent(req: CreateAgentRequest): Promise<AgentEntity> {
    this.ensureInitialized()

    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    if (!req.accessible_paths || req.accessible_paths.length === 0) {
      const defaultPath = path.join(getDataPath(), 'agents', id)
      req.accessible_paths = [defaultPath]
    }

    const serializedReq = this.serializeJsonFields(req)

    const insertData: InsertAgentRow = {
      id,
      type: req.type,
      name: req.name || 'New Agent',
      description: req.description,
      instructions: req.instructions || 'You are a helpful assistant.',
      model: req.model,
      plan_model: req.plan_model,
      small_model: req.small_model,
      configuration: serializedReq.configuration,
      accessible_paths: serializedReq.accessible_paths,
      created_at: now,
      updated_at: now
    }

    await this.database.insert(agentsTable).values(insertData)
    const result = await this.database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)
    if (!result[0]) {
      throw new Error('Failed to create agent')
    }

    const agent = this.deserializeJsonFields(result[0]) as AgentEntity
    return agent
  }

  async getAgent(id: string): Promise<GetAgentResponse | null> {
    this.ensureInitialized()

    const result = await this.database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    const agent = this.deserializeJsonFields(result[0]) as GetAgentResponse
    if (agent.type === 'claude-code') {
      agent.built_in_tools = builtinTools
    }

    return agent
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: GetAgentResponse[]; total: number }> {
    this.ensureInitialized() // Build query with pagination

    const totalResult = await this.database.select({ count: count() }).from(agentsTable)

    const baseQuery = this.database.select().from(agentsTable).orderBy(agentsTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => this.deserializeJsonFields(row)) as GetAgentResponse[]

    agents.forEach((agent) => {
      if (agent.type === 'claude-code') {
        agent.built_in_tools = builtinTools
      }
    })

    return { agents, total: totalResult[0].count }
  }

  async updateAgent(id: string, updates: UpdateAgentRequest): Promise<GetAgentResponse | null> {
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
    if (serializedUpdates.instructions !== undefined) updateData.instructions = serializedUpdates.instructions
    if (serializedUpdates.model !== undefined) updateData.model = serializedUpdates.model
    if (serializedUpdates.plan_model !== undefined) updateData.plan_model = serializedUpdates.plan_model
    if (serializedUpdates.small_model !== undefined) updateData.small_model = serializedUpdates.small_model
    if (serializedUpdates.mcps !== undefined) updateData.mcps = serializedUpdates.mcps
    if (serializedUpdates.configuration !== undefined) updateData.configuration = serializedUpdates.configuration
    if (serializedUpdates.accessible_paths !== undefined)
      updateData.accessible_paths = serializedUpdates.accessible_paths
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
