import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentChannelTable as channelsTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { agentSkillTable as agentSkillsTable } from '@data/db/schemas/agentSkill'
import { agentTaskTable as scheduledTasksTable } from '@data/db/schemas/agentTask'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { modelsService } from '@main/apiServer/services/models'
import { DataApiErrorFactory } from '@shared/data/api'
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
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'

import {
  listMcpTools,
  normalizeAllowedTools,
  resolveAccessiblePaths,
  rowToAgent,
  validateAgentModels
} from '../agentUtils'
import { type AgentModelField, AgentModelValidationError } from '../errors'
import { skillService } from '../skills/SkillService'
import { CHERRY_CLAW_AGENT_ID, isBuiltinAgentId } from './builtin/BuiltinAgentIds'
import { seedWorkspaceTemplates } from './cherryclaw/seedWorkspace'

const logger = loggerService.withContext('AgentService')

export type BuiltinAgentInitResult =
  | { agentId: string; skippedReason?: undefined }
  | { agentId: null; skippedReason: 'deleted' | 'no_model' }

export class AgentService {
  static readonly DEFAULT_AGENT_ID = CHERRY_CLAW_AGENT_ID

  private readonly modelFields: AgentModelField[] = ['model', 'planModel', 'smallModel']

  // Agent Methods
  async createAgent(req: CreateAgentRequest): Promise<CreateAgentResponse> {
    const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    req.accessiblePaths = resolveAccessiblePaths(req.accessiblePaths, id)

    await validateAgentModels(req.type, {
      model: req.model,
      planModel: req.planModel,
      smallModel: req.smallModel
    })

    const insertData: InsertAgentRow = {
      id,
      type: req.type,
      name: req.name || 'New Agent',
      description: req.description,
      instructions: req.instructions || 'You are a helpful assistant.',
      model: req.model,
      planModel: req.planModel,
      smallModel: req.smallModel,
      mcps: req.mcps ?? null,
      allowedTools: req.allowedTools ?? null,
      configuration: req.configuration ?? null,
      accessiblePaths: req.accessiblePaths ?? null,
      sortOrder: 0
    }

    const database = application.get('DbService').getDb()
    // Shift all existing agents' sort_order up by 1 and insert new agent at position 0 atomically
    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          await tx.update(agentsTable).set({ sortOrder: sql`${agentsTable.sortOrder} + 1` })
          await tx.insert(agentsTable).values(insertData)
        }),
      defaultHandlersFor('Agent', id)
    )
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)
    if (!result[0]) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    const agent = rowToAgent(result[0])

    // Seed workspace templates for soul mode agents
    if ((req.configuration as Record<string, unknown> | undefined)?.soul_enabled === true) {
      const workspace = agent.accessiblePaths?.[0]
      if (workspace) {
        await seedWorkspaceTemplates(workspace)
      }
    }

    // Auto-enable every builtin skill for the new agent — they ship with the
    // app and users expect them to work without manual opt-in. Non-builtin
    // skills default to disabled and must be enabled explicitly.
    try {
      await skillService.initSkillsForAgent(agent.id, agent.accessiblePaths?.[0])
    } catch (error) {
      logger.warn('Failed to seed builtin skills for new agent', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return agent
  }

  private async findAgentRow(id: string, options: { includeDeleted?: boolean } = {}): Promise<AgentRow | undefined> {
    const database = application.get('DbService').getDb()
    const whereClause = options.includeDeleted
      ? eq(agentsTable.id, id)
      : and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt))

    const result = await database.select().from(agentsTable).where(whereClause).limit(1)

    return result[0]
  }

  async getAgent(id: string): Promise<GetAgentResponse | null> {
    const row = await this.findAgentRow(id)
    if (!row) {
      return null
    }

    const agent: GetAgentResponse = rowToAgent(row)
    const { tools, legacyIdMap } = await listMcpTools(agent.type, agent.mcps)
    agent.tools = tools
    agent.allowedTools = normalizeAllowedTools(agent.allowedTools, agent.tools, legacyIdMap)

    return agent
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    // Build query with pagination
    const database = application.get('DbService').getDb()
    const visibleAgents = isNull(agentsTable.deletedAt)
    const totalResult = await database.select({ count: count() }).from(agentsTable).where(visibleAgents)

    const sortBy = options.sortBy || 'sortOrder'
    const orderBy = options.orderBy || (sortBy === 'sortOrder' ? 'asc' : 'desc')

    // Map entity-level sortBy keys to row-level column references
    const sortByToColumn: Record<
      string,
      | typeof agentsTable.sortOrder
      | typeof agentsTable.createdAt
      | typeof agentsTable.name
      | typeof agentsTable.updatedAt
    > = {
      sortOrder: agentsTable.sortOrder,
      createdAt: agentsTable.createdAt,
      updatedAt: agentsTable.updatedAt,
      name: agentsTable.name
    }
    const sortField = sortByToColumn[sortBy] ?? agentsTable.sortOrder
    const orderFn = orderBy === 'asc' ? asc : desc

    // Use createdAt DESC as secondary sort for tie-breaking (e.g., after migration when all sortOrder = 0)
    const baseQuery =
      sortBy === 'sortOrder'
        ? database
            .select()
            .from(agentsTable)
            .where(visibleAgents)
            .orderBy(orderFn(sortField), desc(agentsTable.createdAt))
        : database.select().from(agentsTable).where(visibleAgents).orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents: GetAgentResponse[] = result.map((row) => rowToAgent(row))

    await Promise.all(
      agents.map(async (agent) => {
        const { tools, legacyIdMap } = await listMcpTools(agent.type, agent.mcps)
        agent.tools = tools
        agent.allowedTools = normalizeAllowedTools(agent.allowedTools, agent.tools, legacyIdMap)
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
  }): Promise<BuiltinAgentInitResult> {
    const { id, builtinRole, provisionWorkspace } = opts
    try {
      const database = application.get('DbService').getDb()
      const existing = await this.findAgentRow(id, { includeDeleted: true })

      if (existing?.deletedAt) {
        logger.info(`Built-in ${builtinRole} agent was deleted by user — skipping recreation`, { id })
        return { agentId: null, skippedReason: 'deleted' }
      }

      if (existing) {
        // Sync localized description/instructions on every startup (language may have changed)
        const resolvedPaths = resolveAccessiblePaths([], id)
        const workspace = resolvedPaths[0]
        const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined
        if (agentConfig && (agentConfig.description || agentConfig.instructions)) {
          const updateData: UpdateAgentRequest = {}
          if (agentConfig.description) updateData.description = agentConfig.description
          if (agentConfig.instructions) updateData.instructions = agentConfig.instructions
          await this.updateAgent(id, updateData)
        }
        return { agentId: id }
      }

      const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
      const firstModel = modelsRes.data?.[0]
      if (!firstModel) {
        logger.info(`No Anthropic-compatible models available yet — skipping ${builtinRole} creation`)
        return { agentId: null, skippedReason: 'no_model' }
      }

      // Resolve workspace path first so provisioner can copy template files
      const resolvedPaths = resolveAccessiblePaths([], id)
      const workspace = resolvedPaths[0]

      // Provision workspace (.claude/skills, plugins) and read agent.json config
      const agentConfig = workspace ? await provisionWorkspace(workspace, builtinRole) : undefined

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
        accessiblePaths: resolvedPaths,
        configuration
      }

      await validateAgentModels(req.type, { model: req.model })

      const insertData: InsertAgentRow = {
        id,
        type: req.type,
        name: req.name || builtinRole,
        description: req.description,
        instructions: req.instructions || 'You are a helpful assistant.',
        model: req.model,
        configuration: req.configuration ?? null,
        accessiblePaths: req.accessiblePaths ?? null,
        sortOrder: 0
      }

      await withSqliteErrors(
        () =>
          database.transaction(async (tx) => {
            await tx.update(agentsTable).set({ sortOrder: sql`${agentsTable.sortOrder} + 1` })
            await tx.insert(agentsTable).values(insertData)
          }),
        defaultHandlersFor('Agent', id)
      )

      try {
        await skillService.initSkillsForAgent(id, resolvedPaths?.[0])
      } catch (error) {
        logger.warn('Failed to seed builtin skills for built-in agent', {
          agentId: id,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      logger.info(`Created built-in ${builtinRole} agent`, { id })
      return { agentId: id }
    } catch (error) {
      // Only swallow model-validation failures (no compatible model yet). Every
      // other failure — DB errors, FK violations, coding bugs — must surface so
      // we don't silently lose the agent on startup.
      if (error instanceof AgentModelValidationError) {
        logger.warn(`Skipping built-in ${builtinRole} agent: no compatible model`, error)
        return { agentId: null, skippedReason: 'no_model' }
      }
      logger.error(`Failed to init built-in ${builtinRole} agent`, error as Error)
      throw error
    }
  }

  /**
   * Initialize the built-in CherryClaw agent with a fixed ID.
   * Called once at app startup. Safe to call multiple times — skips if the agent already exists.
   * Returns the agent ID if created or already present, or null if no compatible model is available yet.
   */
  async initDefaultCherryClawAgent(): Promise<BuiltinAgentInitResult> {
    const id = AgentService.DEFAULT_AGENT_ID
    try {
      const database = application.get('DbService').getDb()
      const existing = await this.findAgentRow(id, { includeDeleted: true })

      if (existing?.deletedAt) {
        logger.info('Default CherryClaw agent was deleted by user — skipping recreation', { id })
        return { agentId: null, skippedReason: 'deleted' }
      }

      if (existing) {
        return { agentId: id }
      }

      const modelsRes = await modelsService.getModels({ providerType: 'anthropic', limit: 1 })
      const firstModel = modelsRes.data?.[0]
      if (!firstModel) {
        logger.info('No Anthropic-compatible models available yet — skipping default CherryClaw creation')
        return { agentId: null, skippedReason: 'no_model' }
      }

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
        accessiblePaths: [],
        configuration
      }

      const resolvedPaths = resolveAccessiblePaths(req.accessiblePaths, id)
      await validateAgentModels(req.type, { model: req.model })

      const insertData: InsertAgentRow = {
        id,
        type: req.type,
        name: req.name || 'CherryClaw',
        description: req.description,
        instructions: 'You are a helpful assistant.',
        model: req.model,
        configuration: req.configuration ?? null,
        accessiblePaths: resolvedPaths ?? null,
        sortOrder: 0
      }

      await withSqliteErrors(
        () =>
          database.transaction(async (tx) => {
            await tx.update(agentsTable).set({ sortOrder: sql`${agentsTable.sortOrder} + 1` })
            await tx.insert(agentsTable).values(insertData)
          }),
        defaultHandlersFor('Agent', id)
      )

      // Seed workspace templates for soul mode
      const workspace = resolvedPaths?.[0]
      if (workspace) {
        await seedWorkspaceTemplates(workspace)
      }

      try {
        await skillService.initSkillsForAgent(id, workspace)
      } catch (error) {
        logger.warn('Failed to seed builtin skills for CherryClaw agent', {
          agentId: id,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      logger.info('Created default CherryClaw agent', { id })
      return { agentId: id }
    } catch (error) {
      // Only swallow model-validation failures (no compatible model yet).
      // Other failures must bubble up — silently dropping them hid real bugs.
      if (error instanceof AgentModelValidationError) {
        logger.warn('Skipping default CherryClaw agent: no compatible model', error)
        return { agentId: null, skippedReason: 'no_model' }
      }
      logger.error('Failed to init default CherryClaw agent', error as Error)
      throw error
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

    if (updates.accessiblePaths !== undefined) {
      if (updates.accessiblePaths.length === 0) {
        throw DataApiErrorFactory.validation({ accessiblePaths: ['must not be empty'] })
      }
      updates.accessiblePaths = resolveAccessiblePaths(updates.accessiblePaths, id)
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        modelUpdates[field] = updates[field as keyof UpdateAgentRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      await validateAgentModels(existing.type, modelUpdates)
    }

    const updateData: Partial<AgentRow> = {
      updatedAt: Date.now()
    }
    // AgentBaseSchema.shape keys are now camelCase and match row-level field names directly
    const replaceableEntityFields = Object.keys(AgentBaseSchema.shape)
    const shouldReplace = options.replace ?? false

    for (const field of replaceableEntityFields) {
      if (shouldReplace || Object.prototype.hasOwnProperty.call(updates, field)) {
        if (Object.prototype.hasOwnProperty.call(updates, field)) {
          const value = updates[field as keyof typeof updates]
          ;(updateData as Record<string, unknown>)[field] = value ?? null
        } else if (shouldReplace) {
          ;(updateData as Record<string, unknown>)[field] = null
        }
      }
    }

    const database = application.get('DbService').getDb()

    // Read the raw agent row before updating — getAgent() normalizes allowedTools
    // (legacy ID → canonical ID), but sessions store the original format. We need
    // the raw DB values so string comparison against sessions is accurate.
    const rawRows = await database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
    const rawOldAgent = rawRows[0]

    await withSqliteErrors(
      () => database.update(agentsTable).set(updateData).where(eq(agentsTable.id, id)),
      defaultHandlersFor('Agent', id)
    )

    // Sync changed fields to all sessions that still match the agent's old values.
    // Sessions where the user has customized a field are left untouched.
    if (rawOldAgent) {
      await this.syncSettingsToSessions(database, id, rawOldAgent, updates)
    }

    return await this.getAgent(id)
  }

  /**
   * Sync agent settings to all sessions that haven't been individually customized.
   *
   * For each changed field, we compare the session's current value against the agent's
   * OLD value (before update). If they match, the session inherited the default and
   * should receive the new value. If they differ, the user customized that field on
   * the session, so we skip it.
   */
  private async syncSettingsToSessions(
    database: DbType,
    agentId: string,
    rawOldAgent: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<void> {
    // Entity-level and row-level field names are now both camelCase.
    const syncFields = ['model', 'planModel', 'smallModel', 'allowedTools', 'configuration', 'mcps', 'instructions']

    // Only sync fields that are present in the update AND actually changed.
    // JSON.stringify is needed for array/object fields — === compares by reference.
    const changedFields = syncFields.filter((field) => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return false
      return JSON.stringify(updates[field] ?? null) !== JSON.stringify(rawOldAgent[field] ?? null)
    })
    if (changedFields.length === 0) return

    try {
      const sessions = await database.select().from(sessionsTable).where(eq(sessionsTable.agentId, agentId))

      if (sessions.length === 0) return

      await database.transaction(async (tx) => {
        for (const session of sessions) {
          const sessionUpdateData: Partial<Record<string, unknown>> = {}

          for (const field of changedFields) {
            const oldAgentValue = rawOldAgent[field] ?? null
            const sessionValue = (session as Record<string, unknown>)[field] ?? null

            // Only sync if session still has the agent's old value (not user-customized).
            // JSON.stringify is needed for array/object fields — === compares by reference.
            if (JSON.stringify(oldAgentValue) === JSON.stringify(sessionValue)) {
              sessionUpdateData[field] = updates[field] ?? null
            }
          }

          if (Object.keys(sessionUpdateData).length > 0) {
            sessionUpdateData.updatedAt = Date.now()
            await tx.update(sessionsTable).set(sessionUpdateData).where(eq(sessionsTable.id, session.id))
          }
        }
      })

      logger.info('Synced agent settings to sessions', {
        agentId,
        changedFields,
        sessionCount: sessions.length
      })
    } catch (error) {
      // TODO(agents-v2): session sync is intentionally best-effort so a
      // partial failure does not abort the agent update that already
      // committed. Revisit once sessions move onto the DataApi boundary
      // and this method can share the agent-update transaction.
      logger.warn('Failed to sync agent settings to sessions', {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async reorderAgents(orderedIds: string[]): Promise<void> {
    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      async () =>
        database.transaction(async (tx) => {
          for (let i = 0; i < orderedIds.length; i++) {
            await tx.update(agentsTable).set({ sortOrder: i }).where(eq(agentsTable.id, orderedIds[i]))
          }
        }),
      defaultHandlersFor('Agent', orderedIds.join(','))
    )
    logger.info('Agents reordered', { count: orderedIds.length })
  }

  async deleteAgent(id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const agent = await this.findAgentRow(id)

    if (!agent) {
      return false
    }

    if (isBuiltinAgentId(id)) {
      const deletedAt = Date.now()
      const updatedAt = Date.now()

      await withSqliteErrors(
        async () =>
          database.transaction(async (tx) => {
            await tx.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, id))
            await tx.delete(scheduledTasksTable).where(eq(scheduledTasksTable.agentId, id))
            await tx.delete(sessionsTable).where(eq(sessionsTable.agentId, id))
            await tx.update(channelsTable).set({ agentId: null }).where(eq(channelsTable.agentId, id))
            await tx.update(agentsTable).set({ deletedAt, updatedAt }).where(eq(agentsTable.id, id))
          }),
        defaultHandlersFor('Agent', id)
      )

      return true
    }

    const result = await withSqliteErrors(
      async () => database.delete(agentsTable).where(eq(agentsTable.id, id)),
      defaultHandlersFor('Agent', id)
    )

    return result.rowsAffected > 0
  }

  async agentExists(id: string): Promise<boolean> {
    const result = await this.findAgentRow(id)

    return !!result
  }
}

export const agentService = new AgentService()
