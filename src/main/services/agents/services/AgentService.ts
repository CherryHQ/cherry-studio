import path from 'node:path'

import { loggerService } from '@logger'
import { pluginService } from '@main/services/agents/plugins/PluginService'
import { getDataPath } from '@main/utils'
import type {
  AgentEntity,
  CreateAgentRequest,
  CreateAgentResponse,
  GetAgentResponse,
  ListOptions,
  UpdateAgentRequest,
  UpdateAgentResponse
} from '@types'
import { AgentBaseSchema } from '@types'
import { asc, count, desc, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentRow, agentsTable, type InsertAgentRow } from '../database/schema'
import type { AgentModelField } from '../errors'

const logger = loggerService.withContext('AgentService')

export class AgentService extends BaseService {
  private static instance: AgentService | null = null
  private readonly modelFields: AgentModelField[] = ['model', 'plan_model', 'small_model']

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
  async createAgent(req: CreateAgentRequest): Promise<CreateAgentResponse> {
    this.ensureInitialized()

    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    if (!req.accessible_paths || req.accessible_paths.length === 0) {
      const defaultPath = path.join(getDataPath(), 'agents', id)
      req.accessible_paths = [defaultPath]
    }

    if (req.accessible_paths !== undefined) {
      req.accessible_paths = this.ensurePathsExist(req.accessible_paths)
    }

    await this.validateAgentModels(req.type, {
      model: req.model,
      plan_model: req.plan_model,
      small_model: req.small_model
    })

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
    agent.tools = await this.listMcpTools(agent.type, agent.mcps)

    // Load installed_plugins from cache file instead of database
    const workdir = agent.accessible_paths?.[0]
    if (workdir) {
      try {
        agent.installed_plugins = await pluginService.listInstalledFromCache(workdir)
      } catch (error) {
        // Log error but don't fail the request
        logger.warn(`Failed to load installed plugins for agent ${id}`, {
          workdir,
          error: error instanceof Error ? error.message : String(error)
        })
        agent.installed_plugins = []
      }
    } else {
      agent.installed_plugins = []
    }

    return agent
  }

  async getAgentConfigForSDK(id: string): Promise<AgentEntity | null> {
    this.ensureInitialized()

    const result = await this.database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    const agent = this.deserializeJsonFields(result[0]) as AgentEntity
    return agent
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    this.ensureInitialized() // Build query with pagination

    const totalResult = await this.database.select({ count: count() }).from(agentsTable)

    const sortBy = options.sortBy || 'created_at'
    const orderBy = options.orderBy || 'desc'

    const sortField = agentsTable[sortBy]
    const orderFn = orderBy === 'asc' ? asc : desc

    const baseQuery = this.database.select().from(agentsTable).orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => this.deserializeJsonFields(row)) as GetAgentResponse[]

    for (const agent of agents) {
      agent.tools = await this.listMcpTools(agent.type, agent.mcps)
    }

    return { agents, total: totalResult[0].count }
  }

  async updateAgent(
    id: string,
    updates: UpdateAgentRequest,
    options: { replace?: boolean } = {}
  ): Promise<UpdateAgentResponse | null> {
    this.ensureInitialized()

    // Check if agent exists
    const existing = await this.getAgent(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    if (updates.accessible_paths !== undefined) {
      updates.accessible_paths = this.ensurePathsExist(updates.accessible_paths)
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        modelUpdates[field] = updates[field as keyof UpdateAgentRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      await this.validateAgentModels(existing.type, modelUpdates)
    }

    const serializedUpdates = this.serializeJsonFields(updates)

    const updateData: Partial<AgentRow> = {
      updated_at: now
    }
    const replaceableFields = Object.keys(AgentBaseSchema.shape) as (keyof AgentRow)[]
    const shouldReplace = options.replace ?? false

    for (const field of replaceableFields) {
      if (shouldReplace || Object.prototype.hasOwnProperty.call(serializedUpdates, field)) {
        if (Object.prototype.hasOwnProperty.call(serializedUpdates, field)) {
          const value = serializedUpdates[field as keyof typeof serializedUpdates]
          ;(updateData as Record<string, unknown>)[field] = value ?? null
        } else if (shouldReplace) {
          ;(updateData as Record<string, unknown>)[field] = null
        }
      }
    }

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
