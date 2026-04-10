import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
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
import { asc, count, desc, eq, sql } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type AgentRow, agentsTable, type InsertAgentRow } from '../database/schema'
import type { AgentModelField } from '../errors'
import { seedWorkspaceTemplates } from './cherryclaw/seedWorkspace'

const logger = loggerService.withContext('AgentService')

export class AgentService extends BaseService {
  static readonly DEFAULT_AGENT_ID = 'cherry-claw-default'

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
      sort_order: 0,
      created_at: now,
      updated_at: now
    }

    const database = await this.getDatabase()
    // Shift all existing agents' sort_order up by 1 and insert new agent at position 0 atomically
    await database.transaction(async (tx) => {
      await tx.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
      await tx.insert(agentsTable).values(insertData)
    })
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)
    if (!result[0]) {
      throw new Error('Failed to create agent')
    }

    const agent = this.deserializeJsonFields(result[0]) as AgentEntity

    // Seed workspace templates for soul mode agents
    if ((req.configuration as Record<string, unknown> | undefined)?.soul_enabled === true) {
      const workspace = agent.accessible_paths?.[0]
      if (workspace) {
        await seedWorkspaceTemplates(workspace)
      }
    }

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

    return agent
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    // Build query with pagination
    const database = await this.getDatabase()
    const totalResult = await database.select({ count: count() }).from(agentsTable)

    const sortBy = options.sortBy || 'sort_order'
    const orderBy = options.orderBy || (sortBy === 'sort_order' ? 'asc' : 'desc')

    const sortField = agentsTable[sortBy]
    const orderFn = orderBy === 'asc' ? asc : desc

    // Use created_at DESC as secondary sort for tie-breaking (e.g., after migration when all sort_order = 0)
    const baseQuery =
      sortBy === 'sort_order'
        ? database.select().from(agentsTable).orderBy(orderFn(sortField), desc(agentsTable.created_at))
        : database.select().from(agentsTable).orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => this.deserializeJsonFields(row)) as GetAgentResponse[]

    await Promise.all(
      agents.map(async (agent) => {
        const { tools, legacyIdMap } = await this.listMcpTools(agent.type, agent.mcps)
        agent.tools = tools
        agent.allowed_tools = this.normalizeAllowedTools(agent.allowed_tools, agent.tools, legacyIdMap)
      })
    )

    return { agents, total: totalResult[0].count }
  }

  /**
   * Initialize a built-in agent from its bundled agent.json template.
   * Called once at app startup. Safe to call multiple times — skips if the agent already exists.
   * Returns the agent ID if created or already present, or null if no compatible model is available yet.
   *
   * @param opts.id - Fixed agent ID
   * @param opts.builtinRole - Role key used by BuiltinAgentProvisioner (e.g. 'assistant')
   * @param opts.provisionWorkspace - Callback to provision skills/plugins into the workspace and return agent config
   */
  async initBuiltinAgent(opts: {
    id: string
    builtinRole: string
    provisionWorkspace: (
      workspacePath: string,
      builtinRole: string
    ) => Promise<
      | { name?: string; description?: string; instructions?: string; configuration?: Record<string, unknown> }
      | undefined
    >
  }): Promise<string | null> {
    const { id, builtinRole, provisionWorkspace } = opts
    try {
      const database = await this.getDatabase()
      const existing = await database
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.id, id))
        .limit(1)

      if (existing.length > 0) {
        // Sync localized description/instructions on every startup (language may have changed)
        const resolvedPaths = this.resolveAccessiblePaths([], id)
        const workspace = resolvedPaths[0]
        const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined
        if (agentConfig && (agentConfig.description || agentConfig.instructions)) {
          const updateData: Partial<InsertAgentRow> = { updated_at: new Date().toISOString() }
          if (agentConfig.description) updateData.description = agentConfig.description
          if (agentConfig.instructions) updateData.instructions = agentConfig.instructions
          await database.update(agentsTable).set(updateData).where(eq(agentsTable.id, id))
        }
        return id
      }

      const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
      const firstModel = modelsRes.data?.[0]
      if (!firstModel) {
        logger.info(`No Anthropic-compatible models available yet — skipping ${builtinRole} creation`)
        return null
      }

      // Resolve workspace path first so provisioner can copy template files
      const resolvedPaths = this.resolveAccessiblePaths([], id)
      const workspace = resolvedPaths[0]

      // Provision workspace (.claude/skills, plugins) and read agent.json config
      const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined

      const now = new Date().toISOString()
      const configuration: CreateAgentRequest['configuration'] = {
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {},
        ...agentConfig?.configuration
      }

      const req: CreateAgentRequest = {
        type: 'claude-code',
        name: agentConfig?.name || builtinRole,
        description: agentConfig?.description || `Built-in ${builtinRole} agent`,
        instructions: agentConfig?.instructions || 'You are a helpful assistant.',
        model: firstModel.id,
        accessible_paths: resolvedPaths,
        configuration
      }

      await this.validateAgentModels(req.type, { model: req.model })
      const serialized = this.serializeJsonFields(req)

      const insertData: InsertAgentRow = {
        id,
        type: req.type,
        name: req.name || builtinRole,
        description: req.description,
        instructions: req.instructions || 'You are a helpful assistant.',
        model: req.model,
        configuration: serialized.configuration,
        accessible_paths: serialized.accessible_paths,
        sort_order: 0,
        created_at: now,
        updated_at: now
      }

      await database.transaction(async (tx) => {
        await tx.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
        await tx.insert(agentsTable).values(insertData)
      })

      logger.info(`Created built-in ${builtinRole} agent`, { id })
      return id
    } catch (error) {
      logger.error(`Failed to init built-in ${builtinRole} agent`, error as Error)
      return null
    }
  }

  /**
   * Initialize the built-in CherryClaw agent with a fixed ID.
   * Called once at app startup. Safe to call multiple times — skips if the agent already exists.
   * Returns the agent ID if created or already present, or null if no compatible model is available yet.
   */
  async initDefaultCherryClawAgent(): Promise<string | null> {
    const id = AgentService.DEFAULT_AGENT_ID
    try {
      const database = await this.getDatabase()
      const existing = await database
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.id, id))
        .limit(1)

      if (existing.length > 0) {
        return id
      }

      const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
      const firstModel = modelsRes.data?.[0]
      if (!firstModel) {
        logger.info('No Anthropic-compatible models available yet — skipping default CherryClaw creation')
        return null
      }

      const now = new Date().toISOString()
      const configuration: CreateAgentRequest['configuration'] = {
        avatar: '🦞',
        permission_mode: 'bypassPermissions',
        max_turns: 100,
        soul_enabled: true,
        scheduler_enabled: true,
        scheduler_type: 'interval',
        heartbeat_enabled: true,
        heartbeat_interval: 30,
        env_vars: {}
      }

      const req: CreateAgentRequest = {
        type: 'claude-code',
        name: 'Cherry Claw',
        description: 'Default autonomous CherryClaw agent',
        model: firstModel.id,
        accessible_paths: [],
        configuration
      }

      const resolvedPaths = this.resolveAccessiblePaths(req.accessible_paths, id)
      await this.validateAgentModels(req.type, { model: req.model })

      const serialized = this.serializeJsonFields({ ...req, accessible_paths: resolvedPaths })

      const insertData: InsertAgentRow = {
        id,
        type: req.type,
        name: req.name || 'CherryClaw',
        description: req.description,
        instructions: 'You are a helpful assistant.',
        model: req.model,
        configuration: serialized.configuration,
        accessible_paths: serialized.accessible_paths,
        sort_order: 0,
        created_at: now,
        updated_at: now
      }

      await database.transaction(async (tx) => {
        await tx.update(agentsTable).set({ sort_order: sql`${agentsTable.sort_order} + 1` })
        await tx.insert(agentsTable).values(insertData)
      })

      // Seed workspace templates for soul mode
      const workspace = resolvedPaths?.[0]
      if (workspace) {
        await seedWorkspaceTemplates(workspace)
      }

      logger.info('Created default CherryClaw agent', { id })
      return id
    } catch (error) {
      logger.error('Failed to init default CherryClaw agent', error as Error)
      return null
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
      if (updates.accessible_paths.length === 0) {
        throw new Error('accessible_paths must not be empty')
      }
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

  async reorderAgents(orderedIds: string[]): Promise<void> {
    const database = await this.getDatabase()
    await database.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(agentsTable).set({ sort_order: i }).where(eq(agentsTable.id, orderedIds[i]))
      }
    })
    logger.info('Agents reordered', { count: orderedIds.length })
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
