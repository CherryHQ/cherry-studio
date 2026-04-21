import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import {
  type AgentSessionRow as SessionRow,
  agentSessionTable as sessionsTable,
  type InsertAgentSessionRow as InsertSessionRow
} from '@data/db/schemas/agentSession'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { parsePluginMetadata } from '@main/utils/markdownParser'
import {
  AgentBaseSchema,
  type AgentEntity,
  type AgentSessionEntity,
  type CreateSessionRequest,
  type GetAgentSessionResponse,
  type ListOptions,
  type SlashCommand,
  type UpdateSessionRequest,
  type UpdateSessionResponse
} from '@types'
import { and, asc, count, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'

import {
  deserializeJsonFields,
  ensurePathsExist,
  listMcpTools,
  normalizeAllowedTools,
  resolveAccessiblePaths,
  validateAgentModels
} from '../agentUtils'
import type { AgentModelField } from '../errors'
import { builtinSlashCommands } from './claudecode/commands'

const logger = loggerService.withContext('SessionService')

export class SessionService {
  private readonly modelFields: AgentModelField[] = ['model', 'plan_model', 'small_model']

  /**
   * Override BaseService.listSlashCommands to merge builtin and plugin commands
   */
  async listSlashCommands(agentType: string, agentId?: string): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = []

    // Add builtin slash commands
    if (agentType === 'claude-code') {
      commands.push(...builtinSlashCommands)
    }

    // Add local command plugins from .claude/commands/
    if (agentId) {
      try {
        const database = application.get('DbService').getDb()
        const result = await database.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1)
        const agent = result[0] ? deserializeJsonFields(result[0]) : null
        const workdir = (agent as AgentEntity | null)?.accessible_paths?.[0]

        if (workdir) {
          const commandsDir = path.join(workdir, '.claude', 'commands')
          try {
            const entries = await fs.promises.readdir(commandsDir, { withFileTypes: true })
            const ALLOWED_EXTENSIONS = ['.md', '.txt']
            let localCount = 0

            for (const entry of entries) {
              if (!entry.isFile()) continue
              const ext = path.extname(entry.name).toLowerCase()
              if (!ALLOWED_EXTENSIONS.includes(ext)) continue

              try {
                const filePath = path.join(commandsDir, entry.name)
                const metadata = await parsePluginMetadata(
                  filePath,
                  path.join('commands', entry.name),
                  'commands',
                  'command'
                )
                const commandName = entry.name.replace(/\.md$/i, '')
                commands.push({
                  command: `/${commandName}`,
                  description: metadata.description
                })
                localCount++
              } catch {
                // Skip files that fail to parse
              }
            }

            logger.info('Listed slash commands', {
              agentType,
              agentId,
              builtinCount: builtinSlashCommands.length,
              localCount,
              totalCount: commands.length
            })
          } catch {
            // .claude/commands/ doesn't exist, that's fine
          }
        }
      } catch (error) {
        logger.warn('Failed to list local command plugins', {
          agentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return commands
  }

  async createSession(
    agentId: string,
    req: Partial<CreateSessionRequest> = {}
  ): Promise<GetAgentSessionResponse | null> {
    // Validate agent exists - we'll need to import AgentService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

    const database = application.get('DbService').getDb()
    const agents = await database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
      .limit(1)
    if (!agents[0]) {
      throw new Error('Agent not found')
    }
    const agent = deserializeJsonFields(agents[0]) as AgentEntity

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    // inherit configuration from agent by default, can be overridden by sessionData
    const sessionData: Partial<CreateSessionRequest> = {
      ...agent,
      ...req
    }

    await validateAgentModels(agent.type, {
      model: sessionData.model,
      plan_model: sessionData.plan_model,
      small_model: sessionData.small_model
    })

    if (sessionData.accessible_paths !== undefined) {
      sessionData.accessible_paths = ensurePathsExist(sessionData.accessible_paths)
    }

    // `name` and `model` are NOT NULL on agent_session; fall back to the parent
    // agent's values rather than coercing empty strings to null.
    const insertData: InsertSessionRow = {
      id,
      agentId,
      agentType: agent.type,
      name: sessionData.name || agent.name || 'New Session',
      description: sessionData.description ?? null,
      accessiblePaths: sessionData.accessible_paths ?? null,
      instructions: sessionData.instructions ?? null,
      model: sessionData.model || agent.model,
      planModel: sessionData.plan_model ?? null,
      smallModel: sessionData.small_model ?? null,
      mcps: sessionData.mcps ?? null,
      allowedTools: sessionData.allowed_tools ?? null,
      slashCommands: sessionData.slash_commands ?? null,
      configuration: sessionData.configuration ?? null,
      sortOrder: 0
    }

    const db = application.get('DbService').getDb()
    // Shift all existing sessions' sortOrder up by 1 and insert new session at position 0 atomically
    await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          await tx
            .update(sessionsTable)
            .set({ sortOrder: sql`${sessionsTable.sortOrder} + 1` })
            .where(eq(sessionsTable.agentId, agentId))
          await tx.insert(sessionsTable).values(insertData)
        }),
      defaultHandlersFor('Session', id)
    )

    const result = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      throw new Error('Failed to create session')
    }

    const session = deserializeJsonFields(result[0])
    return await this.getSession(agentId, session.id)
  }

  async getSession(agentId: string, id: string): Promise<GetAgentSessionResponse | null> {
    const database = application.get('DbService').getDb()
    const result = await database
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId)))
      .limit(1)

    if (!result[0]) {
      return null
    }

    const session = deserializeJsonFields(result[0]) as GetAgentSessionResponse
    const { tools, legacyIdMap } = await listMcpTools(session.agent_type, session.mcps)
    session.tools = tools
    session.allowed_tools = normalizeAllowedTools(session.allowed_tools, session.tools, legacyIdMap)

    // If slash_commands is not in database yet (e.g., first invoke before init message),
    // fall back to builtin + local commands. Otherwise, use the merged commands from database.
    if (!session.slash_commands || session.slash_commands.length === 0) {
      session.slash_commands = await this.listSlashCommands(session.agent_type, agentId)
    }

    return session
  }

  async listSessions(
    agentId?: string,
    options: ListOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
    // Build where conditions
    const whereConditions: SQL[] = []
    if (agentId) {
      whereConditions.push(eq(sessionsTable.agentId, agentId))
    }

    const whereClause =
      whereConditions.length > 1
        ? and(...whereConditions)
        : whereConditions.length === 1
          ? whereConditions[0]
          : undefined

    // Get total count
    const database = application.get('DbService').getDb()
    const totalResult = await database.select({ count: count() }).from(sessionsTable).where(whereClause)

    const total = totalResult[0].count

    // Build list query with pagination - sort by sortOrder ASC, createdAt DESC for tie-breaking
    const baseQuery = database
      .select()
      .from(sessionsTable)
      .where(whereClause)
      .orderBy(asc(sessionsTable.sortOrder), desc(sessionsTable.createdAt))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const sessions = result.map((row) => deserializeJsonFields(row)) as GetAgentSessionResponse[]

    await Promise.all(
      sessions.map(async (session) => {
        const { tools, legacyIdMap } = await listMcpTools(session.agent_type, session.mcps)
        session.tools = tools
        session.allowed_tools = normalizeAllowedTools(session.allowed_tools, session.tools, legacyIdMap)
      })
    )

    return { sessions, total }
  }

  async updateSession(
    agentId: string,
    id: string,
    updates: UpdateSessionRequest
  ): Promise<UpdateSessionResponse | null> {
    // Check if session exists
    const existing = await this.getSession(agentId, id)
    if (!existing) {
      return null
    }

    // Validate agent exists if changing main_agent_id
    // We'll skip this validation for now to avoid circular dependencies

    if (updates.accessible_paths !== undefined) {
      if (updates.accessible_paths.length === 0) {
        throw new Error('accessible_paths must not be empty')
      }
      updates.accessible_paths = resolveAccessiblePaths(updates.accessible_paths, existing.agent_id)
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        modelUpdates[field] = updates[field as keyof UpdateSessionRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      await validateAgentModels(existing.agent_type, modelUpdates)
    }

    const updateData: Partial<SessionRow> = {
      updatedAt: Date.now()
    }
    // AgentBaseSchema.shape keys are entity-level (snake_case); map them to row-level (camelCase)
    const sessionEntityToRowField: Partial<Record<string, keyof SessionRow>> = {
      accessible_paths: 'accessiblePaths',
      plan_model: 'planModel',
      small_model: 'smallModel',
      allowed_tools: 'allowedTools',
      slash_commands: 'slashCommands',
      name: 'name',
      description: 'description',
      instructions: 'instructions',
      model: 'model',
      mcps: 'mcps',
      configuration: 'configuration'
    }
    const replaceableEntityFields = Object.keys(AgentBaseSchema.shape)

    for (const entityField of replaceableEntityFields) {
      if (Object.prototype.hasOwnProperty.call(updates, entityField)) {
        const rowField = (sessionEntityToRowField[entityField] ?? entityField) as keyof SessionRow
        const value = updates[entityField as keyof typeof updates]
        ;(updateData as Record<string, unknown>)[rowField] = value ?? null
      }
    }

    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      () => database.update(sessionsTable).set(updateData).where(eq(sessionsTable.id, id)),
      defaultHandlersFor('Session', id)
    )

    return await this.getSession(agentId, id)
  }

  async deleteSession(agentId: string, id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId)))

    return result.rowsAffected > 0
  }

  async reorderSessions(agentId: string, orderedIds: string[]): Promise<void> {
    const database = application.get('DbService').getDb()
    await database.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(sessionsTable)
          .set({ sortOrder: i })
          .where(and(eq(sessionsTable.id, orderedIds[i]), eq(sessionsTable.agentId, agentId)))
      }
    })
    logger.info('Sessions reordered', { agentId, count: orderedIds.length })
  }

  async sessionExists(agentId: string, id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId)))
      .limit(1)

    return result.length > 0
  }
}

export const sessionService = new SessionService()
