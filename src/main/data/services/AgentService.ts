import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { pinService } from '@data/services/PinService'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ListOptions } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AGENT_MUTABLE_FIELDS,
  type AgentConfiguration,
  type AgentEntity,
  type CreateAgentDto,
  sanitizeAgentConfiguration,
  type UpdateAgentDto
} from '@shared/data/api/schemas/agents'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'
import { and, asc, count, desc, eq, gte, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentService')

export interface AgentUpdatedEvent {
  agentId: string
  updates: UpdateAgentDto
  agent: AgentEntity
}

export interface AgentCreatedEvent {
  agentId: string
  agent: AgentEntity
}

export interface AgentDeletedEvent {
  agentId: string
}

type AgentEntitySearchItem = Extract<EntitySearchItem, { type: 'agent' }>

function parseConfiguration(raw: unknown): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { invalidKeys })
  }
  return data
}

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object') return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

function rowToAgent(row: AgentRow, modelName: string | null = null, mcps: string[]): AgentEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    mcps,
    type: (row.type === 'cherry-claw' ? 'claude-code' : row.type) as AgentType,
    model: (clean.model ?? null) as UniqueModelId | null,
    planModel: clean.planModel as UniqueModelId | undefined,
    smallModel: clean.smallModel as UniqueModelId | undefined,
    configuration: parseConfiguration(row.configuration),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    modelName
  }
}

/**
 * Fetch mcps for a set of agent IDs from the junction table.
 * Returns a Map<agentId, string[]>.
 * Accepts both a database instance and a transaction (DbOrTx).
 */
async function fetchMcpsForAgents(tx: DbOrTx, agentIds: string[]): Promise<Map<string, string[]>> {
  if (agentIds.length === 0) return new Map()
  const rows = await tx
    .select({ agentId: agentMcpServerTable.agentId, mcpServerId: agentMcpServerTable.mcpServerId })
    .from(agentMcpServerTable)
    .where(inArray(agentMcpServerTable.agentId, agentIds))
    .orderBy(asc(agentMcpServerTable.agentId), asc(agentMcpServerTable.createdAt))
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.agentId)
    if (list) {
      list.push(row.mcpServerId)
    } else {
      map.set(row.agentId, [row.mcpServerId])
    }
  }
  return map
}

export class AgentService {
  private readonly _onAgentCreated = new Emitter<AgentCreatedEvent>()
  readonly onAgentCreated: Event<AgentCreatedEvent> = this._onAgentCreated.event

  private readonly _onAgentUpdated = new Emitter<AgentUpdatedEvent>()
  readonly onAgentUpdated: Event<AgentUpdatedEvent> = this._onAgentUpdated.event

  private readonly _onAgentDeleted = new Emitter<AgentDeletedEvent>()
  readonly onAgentDeleted: Event<AgentDeletedEvent> = this._onAgentDeleted.event

  async createAgent(req: CreateAgentDto): Promise<AgentEntity> {
    const id = uuidv4()
    const mcps = req.mcps ?? []

    // Omit fields that are undefined so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — service supplies the product-strategic default.
    // orderKey is omitted — `insertWithOrderKey` computes the next fractional key.
    const insertData: Omit<InsertAgentRow, 'orderKey'> = {
      id,
      type: req.type,
      name: req.name || 'New Agent',
      description: req.description,
      instructions: req.instructions || 'You are a helpful assistant.',
      model: req.model,
      planModel: req.planModel,
      smallModel: req.smallModel,
      disabledTools: req.disabledTools,
      configuration: req.configuration
    }

    const row = await withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx(async (tx) => {
          const result = await this.createAgentTx(tx, id, insertData)
          // Insert junction rows for MCP associations
          if (mcps.length > 0) {
            await tx.insert(agentMcpServerTable).values(mcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
          }
          return result
        }),
      defaultHandlersFor('Agent', id)
    )
    if (!row) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    const agent = rowToAgent(row.agent, row.modelName || null, mcps)
    this._onAgentCreated.fire({ agentId: id, agent })
    return agent
  }

  async createAgentTx(
    tx: DbOrTx,
    id: string,
    insertData: Omit<InsertAgentRow, 'orderKey'>
  ): Promise<{ agent: AgentRow; modelName: string | null } | null> {
    await insertWithOrderKey(tx, agentsTable, insertData, { pkColumn: agentsTable.id })
    const [joined] = await tx
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(eq(agentsTable.id, id))
      .limit(1)
    return joined ?? null
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
    const database = application.get('DbService').getDb()
    const [row] = await database
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
    if (!row) return null
    const mcpsMap = await fetchMcpsForAgents(database, [id])
    return rowToAgent(row.agent, row.modelName || null, mcpsMap.get(id) ?? [])
  }

  async listAgents(options: ListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    const database = application.get('DbService').getDb()

    // AND-compose deletedAt-null + optional search. Search runs LIKE against
    // name OR description with user-typed wildcards escaped.
    const conditions: SQL[] = [isNull(agentsTable.deletedAt)]
    if (options.search) {
      const pattern = `%${options.search.replace(/[\\%_]/g, '\\$&')}%`
      const nameMatch = sql`${agentsTable.name} LIKE ${pattern} ESCAPE '\\'`
      const descMatch = sql`${agentsTable.description} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(nameMatch, descMatch)
      if (searchClause) conditions.push(searchClause)
    }
    const whereClause = and(...conditions)

    const totalResult = await database.select({ count: count() }).from(agentsTable).where(whereClause)

    const sortBy = options.sortBy ?? 'orderKey'
    const sortOrder = options.sortOrder ?? (sortBy === 'orderKey' ? 'asc' : 'desc')

    const sortByToColumn: Record<
      string,
      | typeof agentsTable.createdAt
      | typeof agentsTable.name
      | typeof agentsTable.updatedAt
      | typeof agentsTable.orderKey
    > = {
      createdAt: agentsTable.createdAt,
      updatedAt: agentsTable.updatedAt,
      name: agentsTable.name,
      orderKey: agentsTable.orderKey
    }
    const sortField = sortByToColumn[sortBy] ?? agentsTable.createdAt
    const orderFn = sortOrder === 'asc' ? asc : desc
    const orderByClauses =
      sortBy === 'updatedAt'
        ? [orderFn(sortField), orderFn(agentsTable.id)]
        : [
            sql`CASE WHEN ${pinTable.orderKey} IS NULL THEN 1 ELSE 0 END`,
            asc(pinTable.orderKey),
            orderFn(sortField),
            orderFn(agentsTable.id)
          ]

    // Pin-aware ordering (skipped for sortBy=updatedAt): LEFT JOIN with the
    // pin table, push pinned rows to the top (sorted by pin.orderKey ASC),
    // then unpinned rows by the caller-specified sortBy/sortOrder. Default
    // ordering follows agent.orderKey so resource-list group reorders persist
    // across reloads.
    const baseQuery = database
      .select({ agent: agentsTable, modelName: userModelTable.name, pinOrderKey: pinTable.orderKey })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .leftJoin(pinTable, and(eq(pinTable.entityType, 'agent'), eq(pinTable.entityId, agentsTable.id)))
      .where(whereClause)
      .orderBy(...orderByClauses)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    // Batch-fetch mcps for all returned agents
    const agentIds = result.map((row) => row.agent.id)
    const mcpsMap = await fetchMcpsForAgents(database, agentIds)

    const agents = result.map((row) => rowToAgent(row.agent, row.modelName || null, mcpsMap.get(row.agent.id) ?? []))

    return { agents, total: totalResult[0].count }
  }

  async search(options: { q: string; limit: number; updatedAtFrom?: number }): Promise<AgentEntitySearchItem[]> {
    const database = application.get('DbService').getDb()
    const pattern = `%${options.q.replace(/[\\%_]/g, '\\$&')}%`
    const nameMatch = sql`${agentsTable.name} LIKE ${pattern} ESCAPE '\\'`
    const descMatch = sql`${agentsTable.description} LIKE ${pattern} ESCAPE '\\'`
    const searchClause = or(nameMatch, descMatch)
    const conditions: SQL[] = [isNull(agentsTable.deletedAt)]
    if (searchClause) conditions.push(searchClause)
    if (options.updatedAtFrom !== undefined) {
      conditions.push(gte(agentsTable.updatedAt, options.updatedAtFrom))
    }

    const rows = await database
      .select({
        id: agentsTable.id,
        name: agentsTable.name,
        description: agentsTable.description,
        configuration: agentsTable.configuration,
        updatedAt: agentsTable.updatedAt
      })
      .from(agentsTable)
      .where(and(...conditions))
      .orderBy(desc(agentsTable.updatedAt), asc(agentsTable.id))
      .limit(options.limit)

    return rows.map((row) => ({
      type: 'agent',
      id: row.id,
      title: row.name,
      subtitle: row.description || undefined,
      emoji: getAgentAvatar(row.configuration),
      updatedAt: timestampToISO(row.updatedAt),
      target: { agentId: row.id }
    }))
  }

  async updateAgent(id: string, updates: UpdateAgentDto): Promise<AgentEntity | null> {
    const existing = await this.getAgent(id)
    if (!existing) return null

    const updateData: Partial<AgentRow> = {
      updatedAt: Date.now()
    }

    // Handle mcps separately — it lives in the junction table, not the agent row.
    const newMcps = updates.mcps

    // Several mutable fields map to NOT NULL columns with DB defaults
    // (description, instructions, disabledTools, configuration). Writing
    // literal NULL when the DTO omits a field would violate the constraint.
    // Skip undefined values so Drizzle preserves the column's current value.
    for (const field of Object.keys(AGENT_MUTABLE_FIELDS)) {
      if (field === 'mcps') continue // handled via junction table
      if (!Object.prototype.hasOwnProperty.call(updates, field)) continue
      const value = updates[field as keyof typeof updates]
      if (value === undefined) continue
      ;(updateData as Record<string, unknown>)[field] = value
    }

    await withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx(async (tx) => {
          await this.updateAgentTx(tx, id, updateData)
          // Replace MCP associations if provided
          if (newMcps !== undefined) {
            await tx.delete(agentMcpServerTable).where(eq(agentMcpServerTable.agentId, id))
            if (newMcps.length > 0) {
              await tx.insert(agentMcpServerTable).values(newMcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
            }
          }
        }),
      defaultHandlersFor('Agent', id)
    )

    const updated = await this.getAgent(id)
    if (updated) {
      this._onAgentUpdated.fire({ agentId: id, updates, agent: updated })
    }
    return updated
  }

  async updateAgentTx(tx: DbOrTx, id: string, updateData: Partial<AgentRow>): Promise<void> {
    await tx.update(agentsTable).set(updateData).where(eq(agentsTable.id, id))
  }

  async deleteAgent(id: string): Promise<boolean> {
    const agent = await this.findAgentRow(id)

    if (!agent) {
      return false
    }

    // Sessions detach (agentId → NULL) via FK ON DELETE SET NULL; their rows
    // and pins survive the agent. Wrap pin purge + agent delete in one
    // transaction so a partial delete cannot leave dangling cross-entity
    // rows behind. `pin` has no FK back here, so this is the only purge
    // needed up-front. Junction table rows are cascade-deleted by FK.
    const result = await withSqliteErrors(
      async () => application.get('DbService').withWriteTx((tx) => this.deleteAgentTx(tx, id)),
      defaultHandlersFor('Agent', id)
    )

    const deleted = result.rowsAffected > 0
    if (deleted) {
      this._onAgentDeleted.fire({ agentId: id })
    }
    return deleted
  }

  async deleteAgentTx(tx: DbOrTx, id: string): Promise<{ rowsAffected: number }> {
    await pinService.purgeForEntityTx(tx, 'agent', id)
    return tx.delete(agentsTable).where(eq(agentsTable.id, id))
  }

  async agentExists(id: string): Promise<boolean> {
    const result = await this.findAgentRow(id)
    return !!result
  }

  /**
   * Move a single agent to a new position in the ordered list. Agents share a
   * single global scope, so no scope predicate is passed to `applyMoves`.
   */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
    logger.info('Reordered agent', { id })
  }

  async reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): Promise<void> {
    const [target] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
    if (!target) throw DataApiErrorFactory.notFound('Agent', id)

    await applyMoves(tx, agentsTable, [{ id, anchor }], { pkColumn: agentsTable.id })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  async reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    const ids = moves.map((m) => m.id)
    const targets = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(inArray(agentsTable.id, ids), isNull(agentsTable.deletedAt)))
    if (targets.length !== ids.length) {
      const found = new Set(targets.map((t) => t.id))
      const missing = ids.find((id) => !found.has(id)) ?? ids[0]
      throw DataApiErrorFactory.notFound('Agent', missing)
    }

    await applyMoves(tx, agentsTable, moves, { pkColumn: agentsTable.id })
  }

  /**
   * Fire onAgentUpdated for each agent ID, re-fetching the agent from DB
   * so subscribers get the current entity state (including mcps from junction table).
   */
  async emitAgentUpdatedForIds(agentIds: string[]): Promise<void> {
    if (agentIds.length === 0) return
    const database = application.get('DbService').getDb()
    const rows = await database
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(and(inArray(agentsTable.id, agentIds), isNull(agentsTable.deletedAt)))
    const mcpsMap = await fetchMcpsForAgents(database, agentIds)
    for (const row of rows) {
      const agent = rowToAgent(row.agent, row.modelName || null, mcpsMap.get(row.agent.id) ?? [])
      this._onAgentUpdated.fire({ agentId: agent.id, updates: { mcps: agent.mcps }, agent })
    }
  }

  /**
   * Transactional variant for use within an outer tx (e.g. McpServerService.delete()).
   * Queries which agents reference the given MCP server, then explicitly deletes
   * the junction rows. The subsequent MCP server DELETE will cascade-delete the
   * same rows again (no-op on empty set). Returns affected agent IDs so the
   * caller can emit onAgentUpdated events after commit.
   */
  async removeMcpFromAllAgentsTx(tx: DbOrTx, mcpServerId: string): Promise<string[]> {
    // Find which agents reference this MCP server before deleting
    const referenced = await tx
      .select({ agentId: agentMcpServerTable.agentId })
      .from(agentMcpServerTable)
      .where(eq(agentMcpServerTable.mcpServerId, mcpServerId))
    const affectedIds = [...new Set(referenced.map((r) => r.agentId))]

    // Delete junction rows explicitly so we can identify affected agent IDs
    // before the cascade from MCP server DELETE removes them.
    await tx.delete(agentMcpServerTable).where(eq(agentMcpServerTable.mcpServerId, mcpServerId))

    return affectedIds
  }
}

export const agentService = new AgentService()
