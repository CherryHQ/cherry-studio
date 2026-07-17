import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentKnowledgeBaseTable, agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentSessionService } from '@data/services/AgentSessionService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { pinService } from '@data/services/PinService'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { DataApiErrorFactory } from '@shared/data/api/errors'
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
import type { ListOptions } from '@shared/data/api/types'
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
type AgentRelationField = 'mcps' | 'knowledgeBaseIds'

function getAgentDescription(description: string, configuration: unknown): string {
  if (description) return description
  if (typeof configuration === 'object' && configuration !== null) {
    if ((configuration as { builtin_role?: unknown }).builtin_role === 'assistant') {
      return t('agent.builtin.cherry_assistant.description')
    }
  }
  return ''
}

function buildAgentSearchPredicate(search: string): SQL {
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${agentsTable.name} LIKE ${pattern} ESCAPE '\\'`
  const descriptionMatch = sql`${agentsTable.description} LIKE ${pattern} ESCAPE '\\'`
  // The builtin description is an i18n-owned fallback when the database value is blank, so include
  // its localized main-process fallback in SQL rather than limiting search to a renderer page.
  const builtinDescriptionMatch = sql`${agentsTable.description} = '' AND json_extract(${agentsTable.configuration}, '$.builtin_role') = 'assistant' AND ${t('agent.builtin.cherry_assistant.description')} LIKE ${pattern} ESCAPE '\\'`
  return or(nameMatch, descriptionMatch, builtinDescriptionMatch)!
}

/**
 * `builtin_role` is a capability identity, not user data: it drives the system prompt, bundle
 * provisioning, settings-source isolation, Assistant MCP injection, and tool auto-approval. It is
 * server-owned — only internal seeding (`createAgentTx`) may write it; the public DataApi surface
 * must not let an ordinary agent forge, change, or drop it.
 */
function getBuiltinRole(configuration: unknown): unknown {
  if (!configuration || typeof configuration !== 'object') return undefined
  return (configuration as { builtin_role?: unknown }).builtin_role
}

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

function rowToAgent(
  row: AgentRow,
  modelName: string | null = null,
  mcps: string[],
  knowledgeBaseIds: string[]
): AgentEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    mcps,
    knowledgeBaseIds,
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
function fetchMcpsForAgents(tx: DbOrTx, agentIds: string[]): Map<string, string[]> {
  if (agentIds.length === 0) return new Map()
  const rows = tx
    .select({ agentId: agentMcpServerTable.agentId, mcpServerId: agentMcpServerTable.mcpServerId })
    .from(agentMcpServerTable)
    .where(inArray(agentMcpServerTable.agentId, agentIds))
    .orderBy(asc(agentMcpServerTable.agentId), asc(agentMcpServerTable.createdAt))
    .all()
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

/**
 * Fetch knowledgeBaseIds for a set of agent IDs from the junction table.
 * Returns a Map<agentId, string[]> with deterministic reads; callers treat the IDs as a set.
 * Accepts both a database instance and a transaction (DbOrTx).
 */
function fetchKnowledgeBasesForAgents(tx: DbOrTx, agentIds: string[]): Map<string, string[]> {
  if (agentIds.length === 0) return new Map()
  const rows = tx
    .select({ agentId: agentKnowledgeBaseTable.agentId, knowledgeBaseId: agentKnowledgeBaseTable.knowledgeBaseId })
    .from(agentKnowledgeBaseTable)
    .where(inArray(agentKnowledgeBaseTable.agentId, agentIds))
    .orderBy(
      asc(agentKnowledgeBaseTable.agentId),
      asc(agentKnowledgeBaseTable.createdAt),
      asc(agentKnowledgeBaseTable.knowledgeBaseId)
    )
    .all()
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.agentId)
    if (list) {
      list.push(row.knowledgeBaseId)
    } else {
      map.set(row.agentId, [row.knowledgeBaseId])
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

  createAgent(req: CreateAgentDto): AgentEntity {
    // Reserved capability identity — see getBuiltinRole. Seeding writes via createAgentTx.
    if (getBuiltinRole(req.configuration) !== undefined) {
      throw DataApiErrorFactory.invalidOperation(
        'create agent',
        'configuration.builtin_role is reserved for system agents'
      )
    }
    const id = uuidv4()
    const mcps = req.mcps ?? []
    const knowledgeBaseIds = req.knowledgeBaseIds ?? []
    const globalSkillService = getDataService('AgentGlobalSkillService')
    const skillIds = Array.from(new Set(req.skillIds ?? []))

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

    // Validate referenced skills before opening the write tx so the main path
    // reports the missing resource as Skill, not as the Agent FK fallback. The
    // write tx rechecks the same IDs before inserting the agent to close the
    // delete-after-prevalidation race.
    // AgentGlobalSkillService is resolved through the registry (not a direct import)
    // to keep this service↔service edge out of the static import graph — see
    // dataServiceRegistry.
    for (const skillId of skillIds) {
      if (!globalSkillService.getById(skillId)) {
        throw DataApiErrorFactory.notFound('Skill', skillId)
      }
    }
    this.assertKnowledgeBasesExistTx(application.get('DbService').getDb(), knowledgeBaseIds)

    const row = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          getDataService('AgentGlobalSkillService').assertSkillsExistTx(tx, skillIds, 'create agent')
          this.assertKnowledgeBasesExistTx(tx, knowledgeBaseIds)
          const result = this.createAgentTx(tx, id, insertData)
          // Insert junction rows for MCP associations
          if (mcps.length > 0) {
            tx.insert(agentMcpServerTable)
              .values(mcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
              .run()
          }
          // Insert junction rows for knowledge base associations
          if (knowledgeBaseIds.length > 0) {
            tx.insert(agentKnowledgeBaseTable)
              .values(knowledgeBaseIds.map((knowledgeBaseId) => ({ agentId: id, knowledgeBaseId })))
              .run()
          }
          // Enable the selected global skills for the new agent. DB-only: workspace
          // symlinks don't exist yet (no session/workspace at create time) and get
          // reconciled later by SkillService when a workspace appears.
          for (const skillId of skillIds) {
            globalSkillService.upsertJoinTx(tx, id, skillId, true)
          }
          return result
        }),
      defaultHandlersFor('Agent', id)
    )
    if (!row) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    const agent = rowToAgent(row.agent, row.modelName || null, mcps, knowledgeBaseIds)
    this._onAgentCreated.fire({ agentId: id, agent })
    return agent
  }

  createAgentTx(
    tx: DbOrTx,
    id: string,
    insertData: Omit<InsertAgentRow, 'orderKey'>
  ): { agent: AgentRow; modelName: string | null } | null {
    insertWithOrderKey(tx, agentsTable, insertData, { pkColumn: agentsTable.id })
    const [joined] = tx
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(eq(agentsTable.id, id))
      .limit(1)
      .all()
    return joined ?? null
  }

  private findAgentRow(id: string, options: { includeDeleted?: boolean } = {}): AgentRow | undefined {
    const database = application.get('DbService').getDb()
    const whereClause = options.includeDeleted
      ? eq(agentsTable.id, id)
      : and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt))

    const result = database.select().from(agentsTable).where(whereClause).limit(1).all()

    return result[0]
  }

  getAgent(id: string): AgentEntity | null {
    const database = application.get('DbService').getDb()
    const [row] = database
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
      .all()
    if (!row) return null
    const mcpsMap = fetchMcpsForAgents(database, [id])
    const knowledgeBasesMap = fetchKnowledgeBasesForAgents(database, [id])
    return rowToAgent(row.agent, row.modelName || null, mcpsMap.get(id) ?? [], knowledgeBasesMap.get(id) ?? [])
  }

  listAgents(options: ListOptions = {}): { agents: AgentEntity[]; total: number } {
    const database = application.get('DbService').getDb()

    // AND-compose deletedAt-null + optional server-side search. The localized builtin
    // fallback is part of the predicate, so pagination and full-library search stay authoritative.
    const conditions: SQL[] = [isNull(agentsTable.deletedAt)]
    if (options.search) {
      conditions.push(buildAgentSearchPredicate(options.search))
    }
    const whereClause = and(...conditions)

    const totalResult = database.select({ count: count() }).from(agentsTable).where(whereClause).all()

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
          ? baseQuery.limit(options.limit).offset(options.offset).all()
          : baseQuery.limit(options.limit).all()
        : baseQuery.all()

    // Batch-fetch mcps + knowledge bases for all returned agents
    const agentIds = result.map((row) => row.agent.id)
    const mcpsMap = fetchMcpsForAgents(database, agentIds)
    const knowledgeBasesMap = fetchKnowledgeBasesForAgents(database, agentIds)

    const agents = result.map((row) =>
      rowToAgent(
        row.agent,
        row.modelName || null,
        mcpsMap.get(row.agent.id) ?? [],
        knowledgeBasesMap.get(row.agent.id) ?? []
      )
    )

    return { agents, total: totalResult[0].count }
  }

  search(options: { q: string; limit: number; updatedAtFrom?: number }): AgentEntitySearchItem[] {
    const database = application.get('DbService').getDb()
    const conditions: SQL[] = [isNull(agentsTable.deletedAt), buildAgentSearchPredicate(options.q)]
    if (options.updatedAtFrom !== undefined) {
      conditions.push(gte(agentsTable.updatedAt, options.updatedAtFrom))
    }

    const rows = database
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
      .all()

    return rows.map((row) => ({
      type: 'agent',
      id: row.id,
      title: row.name,
      subtitle: getAgentDescription(row.description, row.configuration) || undefined,
      emoji: getAgentAvatar(row.configuration),
      updatedAt: timestampToISO(row.updatedAt),
      target: { agentId: row.id }
    }))
  }

  updateAgent(id: string, updates: UpdateAgentDto): AgentEntity | null {
    const existing = this.getAgent(id)
    if (!existing) return null

    // A configuration write may only preserve the existing builtin_role — see getBuiltinRole.
    // Forging or changing it is rejected; omitting it re-injects the stored value so a whole-blob
    // configuration update cannot strip the identity either.
    if (updates.configuration !== undefined) {
      const existingRole = getBuiltinRole(existing.configuration)
      const incomingRole = getBuiltinRole(updates.configuration)
      if (incomingRole !== undefined && incomingRole !== existingRole) {
        throw DataApiErrorFactory.invalidOperation(
          'update agent',
          'configuration.builtin_role is reserved for system agents'
        )
      }
      if (existingRole !== undefined && incomingRole === undefined) {
        updates = { ...updates, configuration: { ...updates.configuration, builtin_role: existingRole } }
      }
    }

    const updateData: Partial<AgentRow> = {
      updatedAt: Date.now()
    }

    // Handle mcps + knowledgeBaseIds separately — they live in junction tables, not the agent row.
    const newMcps = updates.mcps
    const newKnowledgeBaseIds = updates.knowledgeBaseIds
    const newSkillUpdates = updates.skillUpdates

    // Same two-step validation as createAgent: pre-check each id outside the write
    // tx so a missing skill surfaces as `Skill` not-found (not the Agent FK
    // fallback). The in-tx recheck that closes the delete-after-prevalidation race
    // lives inside AgentGlobalSkillService.applyJoinUpdatesByAgentTx. Resolved via the
    // registry to keep the service↔service edge out of the static import graph.
    if (newSkillUpdates !== undefined) {
      for (const update of newSkillUpdates) {
        if (!getDataService('AgentGlobalSkillService').getById(update.skillId)) {
          throw DataApiErrorFactory.notFound('Skill', update.skillId)
        }
      }
    }
    if (newKnowledgeBaseIds !== undefined) {
      this.assertKnowledgeBasesExistTx(application.get('DbService').getDb(), newKnowledgeBaseIds)
    }

    // Several mutable fields map to NOT NULL columns with DB defaults
    // (description, instructions, disabledTools, configuration). Writing
    // literal NULL when the DTO omits a field would violate the constraint.
    // Skip undefined values so Drizzle preserves the column's current value.
    for (const field of Object.keys(AGENT_MUTABLE_FIELDS)) {
      if (field === 'mcps' || field === 'knowledgeBaseIds') continue // handled via junction tables
      if (!Object.prototype.hasOwnProperty.call(updates, field)) continue
      const value = updates[field as keyof typeof updates]
      if (value === undefined) continue
      ;(updateData as Record<string, unknown>)[field] = value
    }

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          if (newKnowledgeBaseIds !== undefined) {
            this.assertKnowledgeBasesExistTx(tx, newKnowledgeBaseIds)
          }
          this.updateAgentTx(tx, id, updateData)
          // Replace MCP associations if provided
          if (newMcps !== undefined) {
            tx.delete(agentMcpServerTable).where(eq(agentMcpServerTable.agentId, id)).run()
            if (newMcps.length > 0) {
              tx.insert(agentMcpServerTable)
                .values(newMcps.map((mcpId) => ({ agentId: id, mcpServerId: mcpId })))
                .run()
            }
          }
          // Replace knowledge base associations if provided
          if (newKnowledgeBaseIds !== undefined) {
            tx.delete(agentKnowledgeBaseTable).where(eq(agentKnowledgeBaseTable.agentId, id)).run()
            if (newKnowledgeBaseIds.length > 0) {
              tx.insert(agentKnowledgeBaseTable)
                .values(newKnowledgeBaseIds.map((knowledgeBaseId) => ({ agentId: id, knowledgeBaseId })))
                .run()
            }
          }
          if (newSkillUpdates !== undefined) {
            getDataService('AgentGlobalSkillService').applyJoinUpdatesByAgentTx(tx, id, newSkillUpdates)
          }
        }),
      defaultHandlersFor('Agent', id)
    )

    const updated = this.getAgent(id)
    if (updated) {
      this._onAgentUpdated.fire({ agentId: id, updates, agent: updated })
    }
    return updated
  }

  updateAgentTx(tx: DbOrTx, id: string, updateData: Partial<AgentRow>): void {
    tx.update(agentsTable).set(updateData).where(eq(agentsTable.id, id)).run()
  }

  deleteAgent(
    id: string,
    options: { deleteSessions?: boolean } = {}
  ): { deleted: boolean; deletedSessionIds?: string[] } {
    // By default sessions detach (agentId → NULL) via FK ON DELETE SET NULL; callers
    // can opt into deleting them in this same transaction. `pin` has no FK back
    // to agent, so purge it alongside the agent row. Junction table rows are
    // cascade-deleted by FK.
    let deletedSessionIds: string[] | undefined
    const result = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [agent] = tx
            .select({ id: agentsTable.id })
            .from(agentsTable)
            .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
            .limit(1)
            .all()
          if (!agent) return { rowsAffected: 0 }

          if (options.deleteSessions === true) {
            deletedSessionIds = agentSessionService.deleteByAgentIdTx(tx, id, { validateAgent: false })
          }

          return this.deleteAgentTx(tx, id)
        }),
      defaultHandlersFor('Agent', id)
    )

    const deleted = result.rowsAffected > 0
    if (deleted) {
      this._onAgentDeleted.fire({ agentId: id })
    }
    return { deleted, deletedSessionIds }
  }

  deleteAgentTx(tx: DbOrTx, id: string): { rowsAffected: number } {
    pinService.purgeForEntityTx(tx, 'agent', id)
    const result = tx.delete(agentsTable).where(eq(agentsTable.id, id)).run()
    return { rowsAffected: result.changes }
  }

  agentExists(id: string): boolean {
    const result = this.findAgentRow(id)
    return !!result
  }

  /**
   * Move a single agent to a new position in the ordered list. Agents share a
   * single global scope, so no scope predicate is passed to `applyMoves`.
   */
  reorder(id: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
    logger.info('Reordered agent', { id })
  }

  reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): void {
    const [target] = tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
      .all()
    if (!target) throw DataApiErrorFactory.notFound('Agent', id)

    applyMoves(tx, agentsTable, [{ id, anchor }], { pkColumn: agentsTable.id })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): void {
    const ids = moves.map((m) => m.id)
    const targets = tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(inArray(agentsTable.id, ids), isNull(agentsTable.deletedAt)))
      .all()
    if (targets.length !== ids.length) {
      const found = new Set(targets.map((t) => t.id))
      const missing = ids.find((id) => !found.has(id)) ?? ids[0]
      throw DataApiErrorFactory.notFound('Agent', missing)
    }

    applyMoves(tx, agentsTable, moves, { pkColumn: agentsTable.id })
  }

  /**
   * Fire onAgentUpdated for each agent ID, re-fetching the agent from DB so subscribers get the
   * current entity state and an update payload naming the relation that changed.
   */
  emitAgentUpdatedForIds(agentIds: string[], relation: AgentRelationField): void {
    if (agentIds.length === 0) return
    const database = application.get('DbService').getDb()
    const rows = database
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(and(inArray(agentsTable.id, agentIds), isNull(agentsTable.deletedAt)))
      .all()
    const mcpsMap = fetchMcpsForAgents(database, agentIds)
    const knowledgeBasesMap = fetchKnowledgeBasesForAgents(database, agentIds)
    for (const row of rows) {
      const agent = rowToAgent(
        row.agent,
        row.modelName || null,
        mcpsMap.get(row.agent.id) ?? [],
        knowledgeBasesMap.get(row.agent.id) ?? []
      )
      const updates: UpdateAgentDto =
        relation === 'mcps' ? { mcps: agent.mcps } : { knowledgeBaseIds: agent.knowledgeBaseIds ?? [] }
      this._onAgentUpdated.fire({ agentId: agent.id, updates, agent })
    }
  }

  private assertKnowledgeBasesExistTx(tx: DbOrTx, knowledgeBaseIds: readonly string[]): void {
    const uniqueIds = [...new Set(knowledgeBaseIds)]
    if (uniqueIds.length === 0) return

    const existing = tx
      .select({ id: knowledgeBaseTable.id })
      .from(knowledgeBaseTable)
      .where(inArray(knowledgeBaseTable.id, uniqueIds))
      .all()
    const existingIds = new Set(existing.map((row) => row.id))
    const missingId = uniqueIds.find((id) => !existingIds.has(id))
    if (missingId) throw DataApiErrorFactory.notFound('KnowledgeBase', missingId)
  }

  /**
   * Transactional variant for use within an outer tx (e.g. McpServerService.delete()).
   * Queries which agents reference the given MCP server, then explicitly deletes
   * the junction rows. The subsequent MCP server DELETE will cascade-delete the
   * same rows again (no-op on empty set). Returns affected agent IDs so the
   * caller can emit onAgentUpdated events after commit.
   */
  removeMcpFromAllAgentsTx(tx: DbOrTx, mcpServerId: string): string[] {
    // Find which agents reference this MCP server before deleting
    const referenced = tx
      .select({ agentId: agentMcpServerTable.agentId })
      .from(agentMcpServerTable)
      .where(eq(agentMcpServerTable.mcpServerId, mcpServerId))
      .all()
    const affectedIds = [...new Set(referenced.map((r) => r.agentId))]

    // Delete junction rows explicitly so we can identify affected agent IDs
    // before the cascade from MCP server DELETE removes them.
    tx.delete(agentMcpServerTable).where(eq(agentMcpServerTable.mcpServerId, mcpServerId)).run()

    return affectedIds
  }

  /** Remove one knowledge base binding from every agent and return the affected agent IDs. */
  removeKnowledgeBaseFromAllAgentsTx(tx: DbOrTx, knowledgeBaseId: string): string[] {
    const referenced = tx
      .select({ agentId: agentKnowledgeBaseTable.agentId })
      .from(agentKnowledgeBaseTable)
      .where(eq(agentKnowledgeBaseTable.knowledgeBaseId, knowledgeBaseId))
      .all()
    const affectedIds = [...new Set(referenced.map((row) => row.agentId))]

    tx.delete(agentKnowledgeBaseTable).where(eq(agentKnowledgeBaseTable.knowledgeBaseId, knowledgeBaseId)).run()

    return affectedIds
  }
}

export const agentService = new AgentService()
