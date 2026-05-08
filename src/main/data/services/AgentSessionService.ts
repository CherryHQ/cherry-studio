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
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentConfiguration,
  type AgentSessionEntity,
  type CreateSessionDto,
  sanitizeAgentConfiguration,
  SESSION_MUTABLE_FIELDS,
  type UpdateSessionDto
} from '@shared/data/api/schemas/agents'
import type { AgentType, ListOptions } from '@types'
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('SessionService')

function parseConfiguration(raw: unknown): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Session configuration drift detected; dropping invalid keys', { invalidKeys })
  }
  return data
}

function agentRowToSessionDefaults(row: Record<string, unknown>): {
  type: AgentType
  model: string | undefined
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
    model: (row.model as string | null) ?? undefined,
    accessiblePaths: row.accessiblePaths as string[],
    configuration: parseConfiguration(row.configuration)
  }
}

function rowToSession(row: SessionRow): AgentSessionEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    agentType: (row.agentType === 'cherry-claw' ? 'claude-code' : row.agentType) as AgentType,
    accessiblePaths: row.accessiblePaths,
    configuration: parseConfiguration(row.configuration),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export function buildSessionUpdateData(updates: UpdateSessionDto, updatedAt = Date.now()): Partial<SessionRow> {
  const updateData: Partial<SessionRow> = { updatedAt }
  const replaceableEntityFields = Object.keys(SESSION_MUTABLE_FIELDS)

  for (const field of replaceableEntityFields) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      const value = updates[field as keyof typeof updates]
      ;(updateData as Record<string, unknown>)[field] = value ?? null
    }
  }

  return updateData
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

    const id = uuidv4()

    const sessionData: CreateSessionDto = {
      ...agent,
      ...req
    }

    const db = application.get('DbService').getDb()

    // Omit undefined fields so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — supply the same product-strategic default
    // AgentService.createAgent uses, so a session created from an agent missing
    // instructions still satisfies NOT NULL.
    const insertData: Omit<InsertSessionRow, 'orderKey'> = {
      id,
      agentId,
      agentType: agent.type,
      name: sessionData.name || agent.name || 'New Session',
      description: sessionData.description,
      accessiblePaths: sessionData.accessiblePaths,
      instructions: sessionData.instructions || 'You are a helpful assistant.',
      // `||` over `??` so empty-string never reaches the FK column.
      model: sessionData.model || agent.model,
      planModel: sessionData.planModel || agent.planModel,
      smallModel: sessionData.smallModel || agent.smallModel,
      mcps: sessionData.mcps,
      allowedTools: sessionData.allowedTools,
      slashCommands: sessionData.slashCommands,
      configuration: sessionData.configuration
    }

    const row = await withSqliteErrors(
      () =>
        db.transaction((tx) =>
          // Prepend within this agent's session bucket.
          insertWithOrderKey(tx, sessionsTable, insertData, {
            pkColumn: sessionsTable.id,
            position: 'first',
            scope: eq(sessionsTable.agentId, agentId)
          })
        ),
      {
        ...defaultHandlersFor('Session', id),
        foreignKey: () => DataApiErrorFactory.notFound('Agent', agentId)
      }
    )

    if (!row) {
      throw DataApiErrorFactory.invalidOperation('create session', 'insert succeeded but select returned no row')
    }

    return rowToSession(row as SessionRow)
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

  /**
   * Look up a session by its primary key alone, without knowing which agent
   * owns it. Use this when the session id is the only identifier available
   * (e.g. streaming dispatch from a topicId like `agent-session:<id>`) — it
   * saves an O(N-agents) `listSessions()` + per-agent `getSession` scan.
   */
  async getById(id: string): Promise<AgentSessionEntity | null> {
    const database = application.get('DbService').getDb()
    const result = await database.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)
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

    const baseQuery = database.select().from(sessionsTable).where(whereClause).orderBy(asc(sessionsTable.orderKey))

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

    const updateData = buildSessionUpdateData(updates)

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

  async reorder(agentId: string, id: string, anchor: OrderRequest): Promise<void> {
    const database = application.get('DbService').getDb()
    await database.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.id, id), eq(sessionsTable.agentId, agentId)))
        .limit(1)
      if (!target) throw DataApiErrorFactory.notFound('Session', id)

      await applyMoves(tx, sessionsTable, [{ id, anchor }], {
        pkColumn: sessionsTable.id,
        scope: eq(sessionsTable.agentId, agentId)
      })
    })
  }

  async reorderBatch(agentId: string, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    const database = application.get('DbService').getDb()
    await database.transaction(async (tx) => {
      const ids = moves.map((m) => m.id)
      const targets = await tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.agentId, agentId)))
      const owned = new Set(targets.map((t) => t.id))
      const stranger = ids.find((id) => !owned.has(id))
      if (stranger) throw DataApiErrorFactory.notFound('Session', stranger)

      await applyMoves(tx, sessionsTable, moves, {
        pkColumn: sessionsTable.id,
        scope: eq(sessionsTable.agentId, agentId)
      })
    })
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
