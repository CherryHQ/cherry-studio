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
import {
  ensurePathsExist,
  listMcpTools,
  normalizeAllowedTools,
  resolveAccessiblePaths,
  rowToAgent,
  rowToSession,
  validateAgentModels
} from '@main/services/agents/agentUtils'
import type { AgentModelField } from '@main/services/agents/errors'
import { builtinSlashCommands } from '@main/services/agents/services/claudecode/commands'
import { parsePluginMetadata } from '@main/utils/markdownParser'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  AgentBaseSchema,
  type AgentSessionEntity,
  type CreateSessionRequest,
  type GetAgentSessionResponse,
  type ListOptions,
  type SlashCommand,
  type UpdateSessionRequest,
  type UpdateSessionResponse
} from '@types'
import { and, asc, count, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'

const logger = loggerService.withContext('SessionService')

export class SessionService {
  private readonly modelFields: AgentModelField[] = ['model', 'planModel', 'smallModel']

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
        const agent = result[0] ? rowToAgent(result[0]) : null
        const workdir = agent?.accessiblePaths?.[0]

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
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }
    const agent = rowToAgent(agents[0])

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    // inherit configuration from agent by default, can be overridden by sessionData
    const sessionData: Partial<CreateSessionRequest> = {
      ...agent,
      ...req
    }

    await validateAgentModels(agent.type, {
      model: sessionData.model,
      planModel: sessionData.planModel,
      smallModel: sessionData.smallModel
    })

    if (sessionData.accessiblePaths !== undefined) {
      sessionData.accessiblePaths = ensurePathsExist(sessionData.accessiblePaths)
    }

    // `name` and `model` are NOT NULL on agent_session; fall back to the parent
    // agent's values rather than coercing empty strings to null.
    const insertData: InsertSessionRow = {
      id,
      agentId,
      agentType: agent.type,
      name: sessionData.name || agent.name || 'New Session',
      description: sessionData.description ?? null,
      accessiblePaths: sessionData.accessiblePaths ?? null,
      instructions: sessionData.instructions ?? null,
      model: sessionData.model || agent.model,
      planModel: sessionData.planModel ?? null,
      smallModel: sessionData.smallModel ?? null,
      mcps: sessionData.mcps ?? null,
      allowedTools: sessionData.allowedTools ?? null,
      slashCommands: sessionData.slashCommands ?? null,
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
      throw DataApiErrorFactory.invalidOperation('create session', 'insert succeeded but select returned no row')
    }

    const session = rowToSession(result[0])
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

    const session: GetAgentSessionResponse = rowToSession(result[0])
    const { tools, legacyIdMap } = await listMcpTools(session.agentType, session.mcps)
    session.tools = tools
    session.allowedTools = normalizeAllowedTools(session.allowedTools, session.tools, legacyIdMap)

    // If slashCommands is not in database yet (e.g., first invoke before init message),
    // fall back to builtin + local commands. Otherwise, use the merged commands from database.
    if (!session.slashCommands || session.slashCommands.length === 0) {
      session.slashCommands = await this.listSlashCommands(session.agentType, agentId)
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

    const sessions: GetAgentSessionResponse[] = result.map((row) => rowToSession(row))

    await Promise.all(
      sessions.map(async (session) => {
        const { tools, legacyIdMap } = await listMcpTools(session.agentType, session.mcps)
        session.tools = tools
        session.allowedTools = normalizeAllowedTools(session.allowedTools, session.tools, legacyIdMap)
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

    if (updates.accessiblePaths !== undefined) {
      if (updates.accessiblePaths.length === 0) {
        throw DataApiErrorFactory.validation({ accessiblePaths: ['must not be empty'] })
      }
      updates.accessiblePaths = resolveAccessiblePaths(updates.accessiblePaths, existing.agentId)
    }

    const modelUpdates: Partial<Record<AgentModelField, string | undefined>> = {}
    for (const field of this.modelFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        modelUpdates[field] = updates[field as keyof UpdateSessionRequest] as string | undefined
      }
    }

    if (Object.keys(modelUpdates).length > 0) {
      await validateAgentModels(existing.agentType, modelUpdates)
    }

    const updateData: Partial<SessionRow> = {
      updatedAt: Date.now()
    }
    // AgentBaseSchema.shape keys are now camelCase and match row-level field names directly
    const replaceableEntityFields = Object.keys(AgentBaseSchema.shape)

    for (const field of replaceableEntityFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        const value = updates[field as keyof typeof updates]
        ;(updateData as Record<string, unknown>)[field] = value ?? null
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
