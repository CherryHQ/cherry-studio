import { application } from '@application'
import { type AgentRow, agentTable as agentsTable, type InsertAgentRow } from '@data/db/schemas/agent'
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
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { insertWithOrderKey } from './utils/orderKey'

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
    configuration: parseConfiguration(row.configuration),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class AgentService {
  async createAgent(req: CreateAgentDto): Promise<AgentEntity> {
    const id = uuidv4()

    const database = application.get('DbService').getDb()

    // Omit fields that are undefined so DB DEFAULTs (e.g. '', '[]', '{}') apply.
    // instructions has no DB DEFAULT — service supplies the product-strategic default.
    const insertData: Omit<InsertAgentRow, 'orderKey'> = {
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
        database.transaction((tx) =>
          // Prepend: place new agent at the head of asc(orderKey) listings.
          insertWithOrderKey(tx, agentsTable, insertData, { pkColumn: agentsTable.id, position: 'first' })
        ),
      defaultHandlersFor('Agent', id)
    )
    if (!row) {
      throw DataApiErrorFactory.invalidOperation('create agent', 'insert succeeded but select returned no row')
    }

    return rowToAgent(row as AgentRow)
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

    const sortBy = options.sortBy ?? 'orderKey'
    const orderBy = options.orderBy ?? (sortBy === 'orderKey' ? 'asc' : 'desc')

    const sortByToColumn: Record<
      string,
      | typeof agentsTable.orderKey
      | typeof agentsTable.createdAt
      | typeof agentsTable.name
      | typeof agentsTable.updatedAt
    > = {
      orderKey: agentsTable.orderKey,
      createdAt: agentsTable.createdAt,
      updatedAt: agentsTable.updatedAt,
      name: agentsTable.name
    }
    const sortField = sortByToColumn[sortBy] ?? agentsTable.orderKey
    const orderFn = orderBy === 'asc' ? asc : desc

    const baseQuery = database.select().from(agentsTable).where(visibleAgents).orderBy(orderFn(sortField))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const agents = result.map((row) => rowToAgent(row))

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
    // and pins survive the agent. Only the agent's own pin entries need a
    // pre-delete purge since `pin` has no FK back here.
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
