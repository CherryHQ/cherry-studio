import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import {
  type AgentSessionRow as SessionRow,
  agentSessionTable as sessionsTable,
  type InsertAgentSessionRow as InsertSessionRow
} from '@data/db/schemas/agentSession'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  AGENT_MUTABLE_FIELDS,
  type AgentConfiguration,
  AgentConfigurationSchema,
  type AgentSessionEntity,
  type CreateSessionDto,
  type UpdateSessionDto
} from '@shared/data/api/schemas/agents'
import type { AgentType, ListOptions } from '@types'
import { and, asc, count, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'

const logger = loggerService.withContext('SessionService')

function agentRowToSessionDefaults(row: Record<string, unknown>): {
  type: AgentType
  model: string
  name: string
  accessiblePaths: string[]
  mcps?: string[]
  allowedTools?: string[]
  configuration?: AgentConfiguration
  description?: string
  instructions?: string
  planModel?: string
  smallModel?: string
} {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: (row.type === 'cherry-claw' ? 'claude-code' : row.type) as AgentType,
    name: (row.name as string) || '',
    model: row.model as string,
    accessiblePaths: row.accessiblePaths as string[],
    configuration: row.configuration != null ? AgentConfigurationSchema.parse(row.configuration) : undefined
  }
}

function rowToSession(row: SessionRow): AgentSessionEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    agentType: (row.agentType === 'cherry-claw' ? 'claude-code' : row.agentType) as AgentType,
    accessiblePaths: row.accessiblePaths,
    configuration: row.configuration != null ? AgentConfigurationSchema.parse(row.configuration) : undefined,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class AgentSessionService {
  async createSession(agentId: string, req: CreateSessionDto = {}): Promise<AgentSessionEntity | null> {
    const database = application.get('DbService').getDb()
    const agents = await database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
      .limit(1)
    if (!agents[0]) {
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }
    const agent = agentRowToSessionDefaults(agents[0] as Record<string, unknown>)

    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    const sessionData: CreateSessionDto = {
      ...agent,
      ...req
    }

    // Omit undefined fields so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — supply the same product-strategic default
    // AgentService.createAgent uses, so a session created from an agent missing
    // instructions still satisfies NOT NULL.
    const insertData: InsertSessionRow = {
      id,
      agentId,
      agentType: agent.type,
      name: sessionData.name || agent.name || 'New Session',
      description: sessionData.description,
      accessiblePaths: sessionData.accessiblePaths,
      instructions: sessionData.instructions || 'You are a helpful assistant.',
      model: sessionData.model || agent.model,
      planModel: sessionData.planModel,
      smallModel: sessionData.smallModel,
      mcps: sessionData.mcps,
      allowedTools: sessionData.allowedTools,
      slashCommands: sessionData.slashCommands,
      configuration: sessionData.configuration,
      sortOrder: 0
    }

    const db = application.get('DbService').getDb()
    await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          await tx
            .update(sessionsTable)
            .set({ sortOrder: sql`${sessionsTable.sortOrder} + 1` })
            .where(eq(sessionsTable.agentId, agentId))
          await tx.insert(sessionsTable).values(insertData)
        }),
      {
        ...defaultHandlersFor('Session', id),
        foreignKey: () => DataApiErrorFactory.notFound('Agent', agentId)
      }
    )

    const result = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)

    if (!result[0]) {
      throw DataApiErrorFactory.invalidOperation('create session', 'insert succeeded but select returned no row')
    }

    return rowToSession(result[0])
  }

  async getSession(agentId: string, id: string): Promise<AgentSessionEntity | null> {
    const database = application.get('DbService').getDb()
    const result = await database
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId)))
      .limit(1)

    if (!result[0]) return null
    return rowToSession(result[0])
  }

  async listSessions(
    agentId?: string,
    options: ListOptions = {}
  ): Promise<{ sessions: AgentSessionEntity[]; total: number }> {
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

    const database = application.get('DbService').getDb()
    const totalResult = await database.select({ count: count() }).from(sessionsTable).where(whereClause)

    const total = totalResult[0].count

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

    const sessions = result.map((row) => rowToSession(row))

    return { sessions, total }
  }

  async updateSession(agentId: string, id: string, updates: UpdateSessionDto): Promise<AgentSessionEntity | null> {
    const existing = await this.getSession(agentId, id)
    if (!existing) return null

    if (updates.accessiblePaths !== undefined && updates.accessiblePaths.length === 0) {
      throw DataApiErrorFactory.validation({ accessiblePaths: ['must not be empty'] })
    }

    const updateData: Partial<SessionRow> = {
      updatedAt: Date.now()
    }

    const replaceableEntityFields = Object.keys(AGENT_MUTABLE_FIELDS)
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
    const result = await withSqliteErrors(
      () => database.delete(sessionsTable).where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId))),
      defaultHandlersFor('Session', id)
    )
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

export const agentSessionService = new AgentSessionService()
