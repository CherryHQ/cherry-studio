import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { agentKnowledgeBaseTable, agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { pinTable } from '@data/db/schemas/pin'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { modelService } from '@data/services/ModelService'
import { pinService } from '@data/services/PinService'
import { promptService } from '@data/services/PromptService'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { BUILTIN_AGENT_ROLE, type BuiltinAgentRole, CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import { resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AGENT_MUTABLE_FIELDS,
  type AgentBase,
  type AgentConfiguration,
  type AgentEntity,
  sanitizeAgentConfiguration,
  type UpdateAgentDto
} from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { ListOptions } from '@shared/data/api/types'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
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
type AgentCreateInput = AgentBase & {
  type: AgentType
  skillIds?: string[]
}

interface EnsureBuiltinAgentInput {
  builtinRole: BuiltinAgentRole
  configuration: AgentConfiguration
  name: string
  preferredModelId: UniqueModelId | null
  type: AgentType
}

export interface EnsureBuiltinAgentResult {
  agent: AgentEntity
  created: boolean
}

function getAgentDescription(id: string, description: string, configuration: unknown): string {
  if (description) return description
  if (typeof configuration === 'object' && configuration !== null) {
    const builtinRole = (configuration as { builtin_role?: unknown }).builtin_role
    if (builtinRole === BUILTIN_AGENT_ROLE.ASSISTANT) {
      return t('agent.builtin.cherry_assistant.description')
    }
    if (id === CHERRY_SUPPORT_AGENT_ID && builtinRole === BUILTIN_AGENT_ROLE.SUPPORT) {
      return t('agent.builtin.cherry_support.description')
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
  const assistantDescriptionMatch = sql`${agentsTable.description} = '' AND json_extract(${agentsTable.configuration}, '$.builtin_role') = ${BUILTIN_AGENT_ROLE.ASSISTANT} AND ${t('agent.builtin.cherry_assistant.description')} LIKE ${pattern} ESCAPE '\\'`
  const supportDescriptionMatch = sql`${agentsTable.id} = ${CHERRY_SUPPORT_AGENT_ID} AND ${agentsTable.description} = '' AND json_extract(${agentsTable.configuration}, '$.builtin_role') = ${BUILTIN_AGENT_ROLE.SUPPORT} AND ${t('agent.builtin.cherry_support.description')} LIKE ${pattern} ESCAPE '\\'`
  return or(nameMatch, descriptionMatch, assistantDescriptionMatch, supportDescriptionMatch)!
}

/**
 * `builtin_role` is a capability identity, not user data. Support additionally requires its
 * reserved ID, so historical configuration cannot grant an ordinary Agent system capabilities.
 * Only internal seeding (`createAgentTx`) may write the role; public DataApi cannot forge it.
 */
function getBuiltinRole(configuration: unknown): unknown {
  if (!configuration || typeof configuration !== 'object') return undefined
  return (configuration as { builtin_role?: unknown }).builtin_role
}

function removeUntrustedSupportRole(id: string, configuration: unknown): Record<string, unknown> {
  const next =
    configuration && typeof configuration === 'object' && !Array.isArray(configuration)
      ? { ...(configuration as Record<string, unknown>) }
      : {}
  if (id === CHERRY_SUPPORT_AGENT_ID || getBuiltinRole(configuration) !== BUILTIN_AGENT_ROLE.SUPPORT) {
    return next
  }
  delete next.builtin_role
  return next
}

/**
 * Apply the public first-level configuration PATCH to the persisted JSON.
 *
 * Object-valued keys (for example `env_vars`) remain whole-value replacements.
 * `builtin_role` is deliberately skipped because it is owned by Main; callers
 * are validated separately before this helper runs.
 */
function applyAgentConfigurationPatch(
  persisted: unknown,
  patch: AgentConfiguration | undefined
): Record<string, unknown> {
  const next =
    persisted && typeof persisted === 'object' && !Array.isArray(persisted)
      ? { ...(persisted as Record<string, unknown>) }
      : {}

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'builtin_role') continue
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }

  return next
}

function parseConfiguration(raw: unknown, agentId: string): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { invalidKeys })
  }
  if (agentId !== CHERRY_SUPPORT_AGENT_ID && data?.builtin_role === BUILTIN_AGENT_ROLE.SUPPORT) {
    delete data.builtin_role
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
    configuration: parseConfiguration(row.configuration, row.id),
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

  /**
   * Create primitive for main-process command orchestration. The caller owns
   * non-data side effects and supplies the already-reserved id.
   */
  createAgentWithId(id: string, req: AgentCreateInput): AgentEntity {
    // Reserved capability identity — see getBuiltinRole. Seeding writes via createAgentTx.
    if (getBuiltinRole(req.configuration) !== undefined) {
      throw DataApiErrorFactory.invalidOperation(
        'create agent',
        'configuration.builtin_role is reserved for system agents'
      )
    }
    const mcps = req.mcps ?? []
    const knowledgeBaseIds = req.knowledgeBaseIds ?? []
    const globalSkillService = getDataService('AgentGlobalSkillService')
    const skillIds = Array.from(new Set(req.skillIds ?? []))

    // Omit fields that are undefined so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — service supplies the product-strategic default.
    // orderKey is omitted — `insertWithOrderKey` computes the fractional key for the requested position.
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
          const result = this.createAgentTx(tx, id, insertData, 'first')
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
    notifyDataApiDataChange([{ endpoint: '/agents', kind: 'membership', entityIds: [id] }])
    this._onAgentCreated.fire({ agentId: id, agent })
    return agent
  }

  createAgentTx(
    tx: DbOrTx,
    id: string,
    insertData: Omit<InsertAgentRow, 'orderKey'>,
    position: 'first' | 'last' = 'last'
  ): { agent: AgentRow; modelName: string | null } | null {
    if (getBuiltinRole(insertData.configuration) === BUILTIN_AGENT_ROLE.SUPPORT && id !== CHERRY_SUPPORT_AGENT_ID) {
      throw DataApiErrorFactory.invalidOperation(
        'create built-in Agent',
        'Cherry Support must use its reserved system identity'
      )
    }
    insertWithOrderKey(tx, agentsTable, insertData, { pkColumn: agentsTable.id, position })
    const [agent] = tx.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1).all()
    if (!agent) return null
    const modelName = agent.model
      ? (modelService.getNamesByUniqueIdsTx(tx, [agent.model]).get(agent.model) ?? null)
      : null
    return { agent, modelName }
  }

  /**
   * Find a built-in Agent by its server-owned capability identity.
   *
   * Seeders use `includeDeleted` so a prior user deletion remains durable, while
   * runtime restore flows look only for an active row.
   */
  findBuiltinAgentByRoleTx(
    tx: DbOrTx,
    builtinRole: string,
    options: { includeDeleted?: boolean } = {}
  ): AgentRow | null {
    const roleCondition =
      builtinRole === BUILTIN_AGENT_ROLE.SUPPORT
        ? and(
            eq(agentsTable.id, CHERRY_SUPPORT_AGENT_ID),
            sql`json_extract(${agentsTable.configuration}, '$.builtin_role') = ${builtinRole}`
          )
        : sql`json_extract(${agentsTable.configuration}, '$.builtin_role') = ${builtinRole}`
    const [agent] = tx
      .select()
      .from(agentsTable)
      .where(options.includeDeleted ? roleCondition : and(isNull(agentsTable.deletedAt), roleCondition))
      .limit(1)
      .all()
    return agent ?? null
  }

  /** Remove legacy Support markers from non-system IDs without changing other Agent data. */
  clearUntrustedBuiltinSupportRolesTx(tx: DbOrTx): void {
    const rows = tx
      .select({ id: agentsTable.id, configuration: agentsTable.configuration })
      .from(agentsTable)
      .where(
        and(
          ne(agentsTable.id, CHERRY_SUPPORT_AGENT_ID),
          sql`json_extract(${agentsTable.configuration}, '$.builtin_role') = ${BUILTIN_AGENT_ROLE.SUPPORT}`
        )
      )
      .all()
    for (const row of rows) {
      tx.update(agentsTable)
        .set({ configuration: removeUntrustedSupportRole(row.id, row.configuration) })
        .where(eq(agentsTable.id, row.id))
        .run()
    }
  }

  /** Claim the reserved Support ID without replacing user-owned fields or relations. */
  claimBuiltinSupportIdentityTx(tx: DbOrTx, options: { restoreDeleted?: boolean } = {}): AgentRow | null {
    const [existing] = tx.select().from(agentsTable).where(eq(agentsTable.id, CHERRY_SUPPORT_AGENT_ID)).limit(1).all()
    if (!existing) return null

    const shouldRestore = options.restoreDeleted === true && existing.deletedAt !== null
    if (getBuiltinRole(existing.configuration) === BUILTIN_AGENT_ROLE.SUPPORT && !shouldRestore) {
      return existing
    }
    const configuration =
      existing.configuration && typeof existing.configuration === 'object' && !Array.isArray(existing.configuration)
        ? { ...existing.configuration, builtin_role: BUILTIN_AGENT_ROLE.SUPPORT }
        : { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT }
    tx.update(agentsTable)
      .set({
        configuration,
        ...(shouldRestore ? { deletedAt: null } : {})
      })
      .where(eq(agentsTable.id, CHERRY_SUPPORT_AGENT_ID))
      .run()

    const [claimed] = tx.select().from(agentsTable).where(eq(agentsTable.id, CHERRY_SUPPORT_AGENT_ID)).limit(1).all()
    return claimed ?? null
  }

  /**
   * Return the active built-in Agent or restore one inside the caller's transaction.
   *
   * The reserved role is injected here, inside the table-owning service, so no
   * renderer or generic Agent create path can forge the built-in identity. The
   * read-before-write transaction makes repeated or concurrent ensure commands
   * converge on one active system Agent.
   */
  ensureBuiltinAgentTx(tx: DbOrTx, input: EnsureBuiltinAgentInput): EnsureBuiltinAgentResult {
    if (input.builtinRole === BUILTIN_AGENT_ROLE.SUPPORT) {
      this.clearUntrustedBuiltinSupportRolesTx(tx)
      this.claimBuiltinSupportIdentityTx(tx, { restoreDeleted: true })
    }
    const existing = this.findBuiltinAgentByRoleTx(tx, input.builtinRole)

    if (existing) {
      const mcps = fetchMcpsForAgents(tx, [existing.id]).get(existing.id) ?? []
      const knowledgeBaseIds = fetchKnowledgeBasesForAgents(tx, [existing.id]).get(existing.id) ?? []
      const modelName = existing.model
        ? (modelService.getNamesByUniqueIdsTx(tx, [existing.model]).get(existing.model) ?? null)
        : null
      return {
        agent: rowToAgent(existing, modelName, mcps, knowledgeBaseIds),
        created: false
      }
    }

    const preferredModel = input.preferredModelId ? modelService.findByIdTx(tx, input.preferredModelId) : null
    const model = preferredModel && isGatewayRoutableModel(preferredModel) ? input.preferredModelId : null
    const agentId = input.builtinRole === BUILTIN_AGENT_ROLE.SUPPORT ? CHERRY_SUPPORT_AGENT_ID : uuidv4()
    const created = this.createAgentTx(tx, agentId, {
      id: agentId,
      type: input.type,
      name: input.name.trim() || 'Built-in Agent',
      description: '',
      instructions: '',
      model,
      configuration: {
        ...input.configuration,
        builtin_role: input.builtinRole
      }
    })

    if (!created) {
      throw DataApiErrorFactory.invalidOperation(
        'restore built-in Agent',
        'insert succeeded but select returned no row'
      )
    }

    return {
      agent: rowToAgent(created.agent, created.modelName, [], []),
      created: true
    }
  }

  /** Publish an Agent creation only after the caller-owned transaction commits. */
  emitAgentCreated(agent: AgentEntity): void {
    notifyDataApiDataChange([{ endpoint: '/agents', kind: 'membership', entityIds: [agent.id] }])
    this._onAgentCreated.fire({ agentId: agent.id, agent })
  }

  /** Return the active built-in Agent or restore one from trusted package defaults. */
  ensureBuiltinAgent(input: EnsureBuiltinAgentInput): AgentEntity {
    const result = application.get('DbService').withWriteTx((tx) => this.ensureBuiltinAgentTx(tx, input))

    if (result.created) {
      this.emitAgentCreated(result.agent)
    }
    return result.agent
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
    const [agent] = database
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
      .limit(1)
      .all()
    if (!agent) return null
    const mcpsMap = fetchMcpsForAgents(database, [id])
    const knowledgeBasesMap = fetchKnowledgeBasesForAgents(database, [id])
    const modelName = agent.model
      ? (modelService.getNamesByUniqueIdsTx(database, [agent.model]).get(agent.model) ?? null)
      : null
    return rowToAgent(agent, modelName, mcpsMap.get(id) ?? [], knowledgeBasesMap.get(id) ?? [])
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
      .select({ agent: agentsTable, pinOrderKey: pinTable.orderKey })
      .from(agentsTable)
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
    const modelNames = modelService.getNamesByUniqueIdsTx(
      database,
      result.map((row) => row.agent.model)
    )

    const agents = result.map((row) =>
      rowToAgent(
        row.agent,
        row.agent.model ? (modelNames.get(row.agent.model) ?? null) : null,
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
      subtitle: getAgentDescription(row.id, row.description, row.configuration) || undefined,
      emoji: getAgentAvatar(row.configuration),
      updatedAt: timestampToISO(row.updatedAt),
      target: { agentId: row.id }
    }))
  }

  updateAgent(id: string, updates: UpdateAgentDto): AgentEntity | null {
    // Preserve the existing not-found precedence before validating related IDs.
    // The authoritative configuration read still happens inside the write tx.
    if (!this.findAgentRow(id)) return null

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

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [current] = tx
            .select()
            .from(agentsTable)
            .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
            .limit(1)
            .all()
          if (!current) throw DataApiErrorFactory.notFound('Agent', id)

          const updateData: Partial<AgentRow> = {
            updatedAt: Date.now()
          }

          // Several mutable fields map to NOT NULL columns with DB defaults
          // (description, instructions, disabledTools, configuration). Writing
          // literal NULL when the DTO omits a field would violate the constraint.
          // Configuration is handled separately as a first-level JSON PATCH.
          for (const field of Object.keys(AGENT_MUTABLE_FIELDS)) {
            if (field === 'mcps' || field === 'knowledgeBaseIds' || field === 'configuration') continue
            if (!Object.prototype.hasOwnProperty.call(updates, field)) continue
            const value = updates[field as keyof typeof updates]
            if (value === undefined) continue
            ;(updateData as Record<string, unknown>)[field] = value
          }

          const configurationPatch = updates.configuration
          const modelChanged = updates.model !== undefined && updates.model !== current.model
          const reasoningEffortPatched =
            configurationPatch !== undefined &&
            Object.prototype.hasOwnProperty.call(configurationPatch, 'reasoning_effort')
          const reasoningEffortRemoved = reasoningEffortPatched && configurationPatch?.reasoning_effort === undefined

          if (configurationPatch !== undefined || modelChanged) {
            const persistedConfiguration = removeUntrustedSupportRole(current.id, current.configuration)
            const existingRole = getBuiltinRole(persistedConfiguration)
            const incomingRole = getBuiltinRole(configurationPatch)
            if (incomingRole !== undefined && incomingRole !== existingRole) {
              throw DataApiErrorFactory.invalidOperation(
                'update agent',
                'configuration.builtin_role is reserved for system agents'
              )
            }

            const nextConfiguration = applyAgentConfigurationPatch(persistedConfiguration, configurationPatch)
            const effectiveModelId = updates.model !== undefined ? updates.model : current.model
            if (!reasoningEffortRemoved && effectiveModelId && (modelChanged || reasoningEffortPatched)) {
              const nextModel = modelService.findByIdTx(tx, effectiveModelId)
              if (nextModel) {
                const currentEffort = parseConfiguration(nextConfiguration, current.id)?.reasoning_effort ?? 'default'
                nextConfiguration.reasoning_effort =
                  resolveReasoningEffortForModel(nextModel, currentEffort) ?? 'default'
              }
            }
            updateData.configuration = nextConfiguration
          }

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
    const result = this.deleteAgentForDelivery(id, options)
    return {
      deleted: result.deleted,
      ...(result.deletedSessionIds ? { deletedSessionIds: result.deletedSessionIds } : {})
    }
  }

  deleteAgentForDelivery(
    id: string,
    options: { deleteSessions?: boolean } = {}
  ): {
    deleted: boolean
    deletedSessionIds?: string[]
    affectedSessionIds: string[]
    deliveryResults: AgentSessionMessageEntity[]
  } {
    // By default sessions detach (agentId → NULL) via FK ON DELETE SET NULL; callers
    // can opt into deleting them in this same transaction. `pin` has no FK back
    // to agent, so purge it alongside the agent row. Junction table rows are
    // cascade-deleted by FK.
    const result = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [agent] = tx
            .select({ id: agentsTable.id })
            .from(agentsTable)
            .where(and(eq(agentsTable.id, id), isNull(agentsTable.deletedAt)))
            .limit(1)
            .all()
          if (!agent) return { rowsAffected: 0, sessionImpact: undefined }

          const sessionImpact = agentSessionService.prepareForAgentDeletionTx(tx, id, {
            deleteSessions: options.deleteSessions === true
          })
          return { ...this.deleteAgentTx(tx, id), sessionImpact }
        }),
      defaultHandlersFor('Agent', id)
    )

    const deleted = result.rowsAffected > 0
    if (deleted && result.sessionImpact) {
      agentTaskService.notifyReadModelChange(result.sessionImpact.taskScheduleIds)
      getDataService('AgentSessionMessageService').publishDeliveryChanges(result.sessionImpact.deliveryResults)
      agentSessionService.notifyReadModelChange(result.sessionImpact.sessionIds, result.sessionImpact.changeKind)
    }
    if (deleted) {
      notifyDataApiDataChange([
        { endpoint: '/agents', kind: 'membership', entityIds: [id] },
        { endpoint: '/agents/:agentId', routeParams: { agentId: id }, entityIds: [id] }
      ])
      promptService.notifyTargetBindingsChanged()
      this._onAgentDeleted.fire({ agentId: id })
    }
    if (deleted) pinService.notifyPurged()
    const deletedSessionIds = options.deleteSessions === true ? result.sessionImpact?.sessionIds : undefined
    return {
      deleted,
      deletedSessionIds,
      affectedSessionIds: result.sessionImpact?.sessionIds ?? [],
      deliveryResults: result.sessionImpact?.deliveryResults ?? []
    }
  }

  deleteAgentTx(tx: DbOrTx, id: string): { rowsAffected: number } {
    pinService.purgeForEntityTx(tx, 'agent', id)
    promptService.purgeForTargetTx(tx, 'agent', id)
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
      .select()
      .from(agentsTable)
      .where(and(inArray(agentsTable.id, agentIds), isNull(agentsTable.deletedAt)))
      .all()
    const mcpsMap = fetchMcpsForAgents(database, agentIds)
    const knowledgeBasesMap = fetchKnowledgeBasesForAgents(database, agentIds)
    const modelNames = modelService.getNamesByUniqueIdsTx(
      database,
      rows.map((row) => row.model)
    )
    for (const row of rows) {
      const agent = rowToAgent(
        row,
        row.model ? (modelNames.get(row.model) ?? null) : null,
        mcpsMap.get(row.id) ?? [],
        knowledgeBasesMap.get(row.id) ?? []
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
