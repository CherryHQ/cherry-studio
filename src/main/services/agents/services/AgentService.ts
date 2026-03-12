import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { pluginService } from '@main/services/agents/plugins/PluginService'
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

  // Agent Methods
  async createAgent(req: CreateAgentRequest): Promise<CreateAgentResponse> {
    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    req.accessible_paths = this.resolveAccessiblePaths(req.accessible_paths, id)

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

    const database = await this.getDatabase()
    await database.insert(agentsTable).values(insertData)
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)
    if (!result[0]) {
      throw new Error('Failed to create agent')
    }

    const agent = this.deserializeJsonFields(result[0]) as AgentEntity
    return agent
  }

  async getAgent(id: string): Promise<GetAgentResponse | null> {
    const database = await this.getDatabase()
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)

    if (!result[0]) {
      return null
    }

    const agent = this.deserializeJsonFields(result[0]) as GetAgentResponse
    const { tools, legacyIdMap } = await this.listMcpTools(agent.type, agent.mcps)
    agent.tools = tools
    agent.allowed_tools = this.normalizeAllowedTools(agent.allowed_tools, agent.tools, legacyIdMap)

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

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    // Ensure a default CherryClaw agent exists
    await this.ensureDefaultCherryClaw()

    // Build query with pagination
    const database = await this.getDatabase()
    const totalResult = await database.select({ count: count() }).from(agentsTable)

    const sortBy = options.sortBy || 'created_at'
    const orderBy = options.orderBy || 'desc'

    const sortField = agentsTable[sortBy]
    const orderFn = orderBy === 'asc' ? asc : desc

    const baseQuery = database.select().from(agentsTable).orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => this.deserializeJsonFields(row)) as GetAgentResponse[]

    for (const agent of agents) {
      const { tools, legacyIdMap } = await this.listMcpTools(agent.type, agent.mcps)
      agent.tools = tools
      agent.allowed_tools = this.normalizeAllowedTools(agent.allowed_tools, agent.tools, legacyIdMap)
    }

    // Sort cherry-claw agents to the top
    agents.sort((a, b) => {
      if (a.type === 'cherry-claw' && b.type !== 'cherry-claw') return -1
      if (a.type !== 'cherry-claw' && b.type === 'cherry-claw') return 1
      return 0
    })

    return { agents, total: totalResult[0].count }
  }

  private async ensureDefaultCherryClaw(): Promise<void> {
    try {
      const database = await this.getDatabase()
      const existing = await database
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.type, 'cherry-claw'))
        .limit(1)

      if (existing.length > 0) return

      // Find the first available Anthropic model
      const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
      const firstModel = modelsRes.data?.[0]
      if (!firstModel) {
        logger.warn('No Anthropic models available — skipping default CherryClaw creation')
        return
      }

      const req: CreateAgentRequest = {
        type: 'cherry-claw',
        name: 'CherryClaw',
        description: 'Default autonomous CherryClaw agent',
        model: firstModel.id,
        accessible_paths: [],
        configuration: {
          permission_mode: 'bypassPermissions',
          max_turns: 100,
          soul_enabled: true,
          scheduler_enabled: false,
          scheduler_type: 'interval',
          heartbeat_enabled: true,
          heartbeat_interval: 30
        }
      }

      const agent = await this.createAgent(req)
      logger.info('Auto-created default CherryClaw agent', { id: agent.id })

      // Create a default session for the auto-created agent
      const { SessionService } = await import('./SessionService')
      const sessionSvc = SessionService.getInstance()
      await sessionSvc.createSession(agent.id, {})
      logger.info('Default session created for CherryClaw agent', { agentId: agent.id })

      // Create the heartbeat scheduled task
      const { schedulerService } = await import('./SchedulerService')
      await schedulerService.ensureHeartbeatTask(agent.id, 30)
      logger.info('Heartbeat task created for CherryClaw agent', { agentId: agent.id })
    } catch (error) {
      logger.error('Failed to ensure default CherryClaw agent', error as Error)
    }
  }

  async updateAgent(
    id: string,
    updates: UpdateAgentRequest,
    options: { replace?: boolean } = {}
  ): Promise<UpdateAgentResponse | null> {
    // Check if agent exists
    const existing = await this.getAgent(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    if (updates.accessible_paths !== undefined) {
      updates.accessible_paths = this.resolveAccessiblePaths(updates.accessible_paths, id)
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

    const database = await this.getDatabase()
    await database.update(agentsTable).set(updateData).where(eq(agentsTable.id, id))
    return await this.getAgent(id)
  }

  async deleteAgent(id: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database.delete(agentsTable).where(eq(agentsTable.id, id))

    return result.rowsAffected > 0
  }

  async agentExists(id: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, id))
      .limit(1)

    return result.length > 0
  }
}

export const agentService = AgentService.getInstance()
