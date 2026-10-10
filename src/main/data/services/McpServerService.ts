/**
 * MCP Server Service - handles MCP server CRUD operations
 *
 * Provides business logic for:
 * - MCP server CRUD operations
 * - Listing with optional filters (isActive, type)
 */

import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'

import { application } from '@application'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateMcpServerDto, ListMcpServersQuery, UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:McpServerService')

/**
 * Convert database row to McpServer entity
 */
function rowToMcpServer(row: typeof mcpServerTable.$inferSelect): McpServer {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type as McpServer['type'],
    installSource: clean.installSource as McpServer['installSource'],
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class McpServerService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * Get an MCP server by ID
   */
  getById(id: string): McpServer {
    const [row] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('McpServer', id)
    }

    return rowToMcpServer(row)
  }

  /**
   * List MCP servers with optional filters
   */
  list(query: ListMcpServersQuery): { items: McpServer[]; total: number; page: number } {
    const conditions: SQL[] = []
    if (query.id !== undefined) {
      conditions.push(eq(mcpServerTable.id, query.id))
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(mcpServerTable.isActive, query.isActive))
    }
    if (query.type !== undefined) {
      conditions.push(eq(mcpServerTable.type, query.type))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = this.db.select().from(mcpServerTable).where(whereClause).orderBy(asc(mcpServerTable.sortOrder)).all()
    const [{ count }] = this.db
      .select({ count: sql<number>`count(*)` })
      .from(mcpServerTable)
      .where(whereClause)
      .all()

    return {
      items: rows.map(rowToMcpServer),
      total: count,
      page: 1
    }
  }

  /**
   * Create a new MCP server
   */
  create(dto: CreateMcpServerDto): McpServer {
    this.validateName(dto.name)
    this.validateQVerisConfiguration({ name: dto.name, env: dto.env, isActive: dto.isActive ?? false })

    const { sortOrder, isActive, ...rest } = dto

    const [row] = this.db
      .insert(mcpServerTable)
      .values({
        ...rest,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? false
      })
      .returning()
      .all()

    logger.info('Created MCP server', { id: row.id, name: row.name })

    return rowToMcpServer(row)
  }

  createMany(dtos: CreateMcpServerDto[]): McpServer[] {
    const created = application.get('DbService').withWriteTx((tx) => {
      const names = new Set<string>()
      for (const dto of dtos) {
        this.validateName(dto.name)
        this.validateQVerisConfiguration({ name: dto.name, env: dto.env, isActive: dto.isActive ?? false })
        if (names.has(dto.name)) {
          throw DataApiErrorFactory.conflict(`MCP server '${dto.name}' already exists`, 'McpServer')
        }
        names.add(dto.name)
      }

      const existing = tx
        .select({ name: mcpServerTable.name })
        .from(mcpServerTable)
        .where(inArray(mcpServerTable.name, [...names]))
        .get()
      if (existing) {
        throw DataApiErrorFactory.conflict(`MCP server '${existing.name}' already exists`, 'McpServer')
      }

      return dtos.map(({ sortOrder, isActive, ...rest }) => {
        const [row] = tx
          .insert(mcpServerTable)
          .values({
            ...rest,
            sortOrder: sortOrder ?? 0,
            isActive: isActive ?? false
          })
          .returning()
          .all()
        return row
      })
    })

    logger.info('Created MCP servers', { count: created.length })
    return created.map(rowToMcpServer)
  }

  /**
   * Update an existing MCP server
   */
  update(id: string, dto: UpdateMcpServerDto): McpServer {
    const result = application.get('DbService').withWriteTx((tx) => {
      const [existingRow] = tx.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1).all()
      if (!existingRow) {
        throw DataApiErrorFactory.notFound('McpServer', id)
      }

      const existing = rowToMcpServer(existingRow)
      const name = dto.name ?? existing.name
      const env = dto.env ?? existing.env
      const isActive = dto.isActive ?? existing.isActive

      this.validateName(name)
      this.validateQVerisConfiguration({ name, env, isActive })

      const updates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<
        typeof mcpServerTable.$inferInsert
      >
      const [row] = tx.update(mcpServerTable).set(updates).where(eq(mcpServerTable.id, id)).returning().all()
      return rowToMcpServer(row)
    })

    logger.info('Updated MCP server', { id, changes: Object.keys(dto) })

    return result
  }

  /**
   * Find an MCP server by ID or name. Returns undefined if not found.
   */
  findByIdOrName(idOrName: string): McpServer | undefined {
    const [row] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, idOrName)).limit(1).all()

    if (row) return rowToMcpServer(row)

    const [byName] = this.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, idOrName)).limit(1).all()

    return byName ? rowToMcpServer(byName) : undefined
  }

  /**
   * Delete an MCP server and cascade-remove its associations from all agents.
   * Junction table rows are explicitly removed first so we can identify affected
   * agents for event emission; FK ON DELETE CASCADE is a safety net.
   */
  delete(id: string): void {
    this.getById(id)

    let affectedAgentIds: string[] = []
    application.get('DbService').withWriteTx((tx) => {
      affectedAgentIds = agentService.removeMcpFromAllAgentsTx(tx, id)
      tx.delete(mcpServerTable).where(eq(mcpServerTable.id, id)).run()
    })

    // The delete has already committed. `emitAgentUpdatedForIds` runs a
    // best-effort post-commit refresh (fresh reads) whose failure must NOT
    // reject delete() — the server row is already gone. Log the un-refreshed
    // agents so warm sessions can be reconciled, then swallow.
    try {
      agentService.emitAgentUpdatedForIds(affectedAgentIds, 'mcps')
    } catch (error) {
      logger.error('MCP server deleted but agent refresh failed; affected agents may retain stale tool policy', {
        mcpServerId: id,
        affectedAgentIds,
        error
      })
    }

    logger.info('Deleted MCP server', { id })
  }

  /**
   * Reorder MCP servers by updating sortOrder based on ordered IDs
   */
  reorder(orderedIds: string[]): void {
    this.db.transaction((tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        tx.update(mcpServerTable).set({ sortOrder: i }).where(eq(mcpServerTable.id, orderedIds[i])).run()
      }
    })

    logger.info('Reordered MCP servers', { count: orderedIds.length })
  }

  private validateName(name: string): void {
    if (!name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }

  private validateQVerisConfiguration(server: Pick<McpServer, 'name' | 'env' | 'isActive'>): void {
    if (server.name === BuiltinMcpServerNames.qveris && server.isActive && !server.env?.QVERIS_API_KEY?.trim()) {
      throw DataApiErrorFactory.validation({ env: ['QVERIS_API_KEY is required when QVeris is enabled'] })
    }
  }
}

export const mcpServerService = new McpServerService()
