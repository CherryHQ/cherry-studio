import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { pinService } from '@data/services/PinService'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  AGENT_MUTABLE_FIELDS,
  type AgentConfiguration,
  type AgentEntity,
  type CreateAgentDto,
  sanitizeAgentConfiguration,
  type UpdateAgentDto
} from '@shared/data/api/schemas/agents'
import type { AgentType, ListOptions } from '@types'
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentService')

function parseConfiguration(raw: unknown): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { invalidKeys })
  }
  return data
}

function rowToAgent(row: AgentRow): AgentEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: (row.type === 'cherry-claw' ? 'claude-code' : row.type) as AgentType,
    accessiblePaths: row.accessiblePaths,
    configuration: parseConfiguration(row.configuration),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Compute the default workspace paths for an agent without creating any directories. */
function computeWorkspacePaths(paths: string[] | undefined): string[] {
  if (paths && paths.length > 0) return paths
  // Workspace dir uses its own uuid, decoupled from agent.id, so id-format
  // changes never require moving on-disk workspaces.
  return [`${application.getPath('feature.agents.workspaces')}/${uuidv4()}`]
}

export class AgentService {
  async createAgent(req: CreateAgentDto): Promise<AgentEntity> {
    const id = uuidv4()

    // Compute workspace paths (pure — directory creation is the caller's responsibility).
    const resolvedPaths = computeWorkspacePaths(req.accessiblePaths)

    // Omit fields that are undefined so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — service supplies the product-strategic default.
    const insertData: Omit<InsertAgentRow, 'sortOrder'> = {
      id,
      type: req.type,
      name: req.name || 'New Agent',
      description: req.description,
      instructions: req.instructions || 'You are a helpful assistant.',
      model: req.model,
      planModel: req.planModel,
      smallModel: req.smallModel,
      mcps: req.mcps,
      allowedTools: req.allowedTools,
      configuration: req.configuration,
      accessiblePaths: resolvedPaths
    }

    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          // Prepend: place new agent ahead of existing rows under asc(sortOrder).
          // Avoids the prior O(N) `sort_order = sort_order + 1` rewrite while
          // preserving the user-visible "newest at top" ordering.
          const [minRow] = await tx
            .select({ min: sql<number>`COALESCE(MIN(${agentsTable.sortOrder}), 0)` })
            .from(agentsTable)
          const sortOrder = (minRow?.min ?? 0) - 1
          await tx.insert(agentsTable).values({ ...insertData, sortOrder })
        }),
      defaultHandlersFor('Agent', id)
    )
    const result = await database.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1)
    if (!result[0]) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    return rowToAgent(result[0])
  }

  private async findAgentRow(id: string, options: { includeDeleted?: boolean } = {}): Promise<AgentRow | undefined> {
    const database = application.get('DbService').getDb()
    const whereClause = options.includeDeleted
      ? eq(agentsTable.id, id)
      : and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt))

    const result = await database.select().from(agentsTable).where(whereClause).limit(1)

    return result[0]
  }

  async getAgent(id: string): Promise<AgentEntity | null> {
    const row = await this.findAgentRow(id)
    if (!row) return null
    return rowToAgent(row)
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    const database = application.get('DbService').getDb()
    const visibleAgents = isNull(agentsTable.deletedAt)
    const totalResult = await database.select({ count: count() }).from(agentsTable).where(visibleAgents)

    const sortBy = options.sortBy || 'sortOrder'
    const orderBy = options.orderBy || (sortBy === 'sortOrder' ? 'asc' : 'desc')

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

    const agents = result.map((row) => rowToAgent(row))

    return { agents, total: totalResult[0].count }
  }

  async updateAgent(
    id: string,
    updates: UpdateAgentDto,
    options: { replace?: boolean } = {}
  ): Promise<AgentEntity | null> {
    const existing = await this.getAgent(id)
    if (!existing) return null

    if (updates.accessiblePaths !== undefined && updates.accessiblePaths.length === 0) {
      throw DataApiErrorFactory.validation({ accessiblePaths: ['must not be empty'] })
    }

    const updateData: Partial<AgentRow> = {
      updatedAt: Date.now()
    }

    const replaceableEntityFields = Object.keys(AGENT_MUTABLE_FIELDS)
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

    const rawRows = await database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
    const rawOldAgent = rawRows[0]

    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          await tx.update(agentsTable).set(updateData).where(eq(agentsTable.id, id))
          if (rawOldAgent) {
            await this.syncSettingsToSessions(tx, id, rawOldAgent, updates)
          }
        }),
      defaultHandlersFor('Agent', id)
    )

    return await this.getAgent(id)
  }

  /**
   * Sync agent settings to all sessions that haven't been individually customized.
   * Must be called inside a transaction so agent update and session sync are atomic.
   */
  private async syncSettingsToSessions(
    tx: DbOrTx,
    agentId: string,
    rawOldAgent: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<void> {
    const syncFields = ['model', 'planModel', 'smallModel', 'allowedTools', 'configuration', 'mcps', 'instructions']

    const changedFields = syncFields.filter((field) => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return false
      return JSON.stringify(updates[field] ?? null) !== JSON.stringify(rawOldAgent[field] ?? null)
    })
    if (changedFields.length === 0) return

    const sessions = await tx.select().from(sessionsTable).where(eq(sessionsTable.agentId, agentId))
    if (sessions.length === 0) return

    for (const session of sessions) {
      const sessionUpdateData: Partial<Record<string, unknown>> = {}

      for (const field of changedFields) {
        const oldAgentValue = rawOldAgent[field] ?? null
        const sessionValue = (session as Record<string, unknown>)[field] ?? null

        if (JSON.stringify(oldAgentValue) === JSON.stringify(sessionValue)) {
          sessionUpdateData[field] = updates[field] ?? null
        }
      }

      if (Object.keys(sessionUpdateData).length > 0) {
        sessionUpdateData.updatedAt = Date.now()
        await tx.update(sessionsTable).set(sessionUpdateData).where(eq(sessionsTable.id, session.id))
      }
    }

    logger.info('Synced agent settings to sessions', {
      agentId,
      changedFields,
      sessionCount: sessions.length
    })
  }

  async reorderAgents(orderedIds: string[]): Promise<void> {
    const database = application.get('DbService').getDb()
    await database.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(agentsTable).set({ sortOrder: i }).where(eq(agentsTable.id, orderedIds[i]))
      }
    })
    logger.info('Agents reordered', { count: orderedIds.length })
  }

  async deleteAgent(id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const agent = await this.findAgentRow(id)

    if (!agent) {
      return false
    }

    // Wrap pin purge + agent delete in one transaction so a partial delete cannot leave
    // dangling pin rows behind (mirrors AssistantService.delete + ProviderService.delete).
    const result = await withSqliteErrors(
      async () =>
        database.transaction(async (tx) => {
          await pinService.purgeForEntity(tx, 'agent', id)
          return tx.delete(agentsTable).where(eq(agentsTable.id, id))
        }),
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
