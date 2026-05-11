import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { ListOptions } from '@data/db/types'
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
import type { AgentType } from '@shared/data/types/agent'
import { and, asc, count, desc, eq, isNull, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentService')

function parseConfiguration(raw: unknown): AgentConfiguration | undefined {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  if (invalidKeys.length > 0) {
    logger.warn('Agent configuration drift detected; dropping invalid keys', { invalidKeys })
  }
  return data
}

function rowToAgent(row: AgentRow, modelName: string | null = null): AgentEntity {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: (row.type === 'cherry-claw' ? 'claude-code' : row.type) as AgentType,
    configuration: parseConfiguration(row.configuration),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    modelName
  }
}

export class AgentService {
  async createAgent(req: CreateAgentDto): Promise<AgentEntity> {
    const id = uuidv4()

    const database = application.get('DbService').getDb()

    // Omit fields that are undefined so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — service supplies the product-strategic default.
    const insertData: InsertAgentRow = {
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
      configuration: req.configuration
    }

    const row = await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          await tx.insert(agentsTable).values(insertData)
          const [joined] = await tx
            .select({ agent: agentsTable, modelName: userModelTable.name })
            .from(agentsTable)
            .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
            .where(eq(agentsTable.id, id))
            .limit(1)
          return joined ?? null
        }),
      defaultHandlersFor('Agent', id)
    )
    if (!row) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    return rowToAgent(row.agent, row.modelName || null)
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
    return rowToAgent(row.agent, row.modelName || null)
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

    // Agents are unordered: no fractional-indexing `orderKey`. Default to
    // `createdAt desc` so the most recently created agent shows up first.
    const sortBy = options.sortBy ?? 'createdAt'
    const orderBy = options.orderBy ?? 'desc'

    const sortByToColumn: Record<
      string,
      typeof agentsTable.createdAt | typeof agentsTable.name | typeof agentsTable.updatedAt
    > = {
      createdAt: agentsTable.createdAt,
      updatedAt: agentsTable.updatedAt,
      name: agentsTable.name
    }
    const sortField = sortByToColumn[sortBy] ?? agentsTable.createdAt
    const orderFn = orderBy === 'asc' ? asc : desc

    const baseQuery = database
      .select({ agent: agentsTable, modelName: userModelTable.name })
      .from(agentsTable)
      .leftJoin(userModelTable, eq(agentsTable.model, userModelTable.id))
      .where(whereClause)
      .orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => rowToAgent(row.agent, row.modelName || null))

    return { agents, total: totalResult[0].count }
  }

  async updateAgent(id: string, updates: UpdateAgentDto): Promise<AgentEntity | null> {
    const existing = await this.getAgent(id)
    if (!existing) return null

    const updateData: Partial<AgentRow> = {
      updatedAt: Date.now()
    }

    // Several mutable fields map to NOT NULL columns with DB defaults
    // (description, instructions, mcps, allowedTools, configuration). Writing
    // literal NULL when the DTO omits a field would violate the constraint.
    // Skip undefined values so Drizzle preserves the column's current value.
    for (const field of Object.keys(AGENT_MUTABLE_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) continue
      const value = updates[field as keyof typeof updates]
      if (value === undefined) continue
      ;(updateData as Record<string, unknown>)[field] = value
    }

    const database = application.get('DbService').getDb()

    await withSqliteErrors(
      () => database.update(agentsTable).set(updateData).where(eq(agentsTable.id, id)),
      defaultHandlersFor('Agent', id)
    )

    return await this.getAgent(id)
  }

  async deleteAgent(id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const agent = await this.findAgentRow(id)

    if (!agent) {
      return false
    }

    // Sessions detach (agentId → NULL) via FK ON DELETE SET NULL; their rows
    // and pins survive the agent. Wrap pin purge + agent delete in one
    // transaction so a partial delete cannot leave dangling cross-entity
    // rows behind. `pin` has no FK back here, so this is the only purge
    // needed up-front.
    const result = await withSqliteErrors(
      async () =>
        database.transaction(async (tx) => {
          await pinService.purgeForEntityTx(tx, 'agent', id)
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
