import type { AgentEntity, AgentType, PermissionMode } from '@types'

import { BaseService } from '../BaseService'
import { AgentQueries_Legacy as AgentQueries } from '../database'

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

    await this.database.execute({
      sql: AgentQueries.agents.insert,
      args: values
    })

    const result = await this.database.execute({
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

    const result = await this.database.execute({
      sql: AgentQueries.agents.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeJsonFields(result.rows[0]) as AgentEntity
  }

  async listAgents(options: ListAgentsOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const countResult = await this.database.execute(AgentQueries.agents.count)
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

    const result = await this.database.execute({
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

    await this.database.execute({
      sql: AgentQueries.agents.update,
      args: values
    })

    return await this.getAgent(id)
  }

  async deleteAgent(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.agents.delete,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async agentExists(id: string): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.agents.checkExists,
      args: [id]
    })

    return result.rows.length > 0
  }
}

export const agentService = AgentService.getInstance()
