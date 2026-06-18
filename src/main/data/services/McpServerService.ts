/**
 * MCP Server Service - handles MCP server CRUD operations
 *
 * Provides business logic for:
 * - MCP server CRUD operations
 * - Listing with optional filters (isActive, type)
 */

import { application } from '@application'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMcpServerDto, ListMcpServersQuery, UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'

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
  async getById(id: string): Promise<McpServer> {
    const [row] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('McpServer', id)
    }

    return rowToMcpServer(row)
  }

  /**
   * List MCP servers with optional filters
   */
  async list(query: ListMcpServersQuery): Promise<{ items: McpServer[]; total: number; page: number }> {
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

    const [rows, [{ count }]] = await Promise.all([
      this.db.select().from(mcpServerTable).where(whereClause).orderBy(asc(mcpServerTable.sortOrder)),
      this.db.select({ count: sql<number>`count(*)` }).from(mcpServerTable).where(whereClause)
    ])

    return {
      items: rows.map(rowToMcpServer),
      total: count,
      page: 1
    }
  }

  /**
   * Create a new MCP server
   */
  async create(dto: CreateMcpServerDto): Promise<McpServer> {
    this.validateName(dto.name)

    const { sortOrder, isActive, ...rest } = dto

    const [row] = await this.db
      .insert(mcpServerTable)
      .values({
        ...rest,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? false
      })
      .returning()

    logger.info('Created MCP server', { id: row.id, name: row.name })

    return rowToMcpServer(row)
  }

  /**
   * Update an existing MCP server
   */
  async update(id: string, dto: UpdateMcpServerDto): Promise<McpServer> {
    await this.getById(id)

    if (dto.name !== undefined) {
      this.validateName(dto.name)
    }

    const updates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<
      typeof mcpServerTable.$inferInsert
    >

    const [row] = await this.db.update(mcpServerTable).set(updates).where(eq(mcpServerTable.id, id)).returning()

    logger.info('Updated MCP server', { id, changes: Object.keys(dto) })

    return rowToMcpServer(row)
  }

  /**
   * Find an MCP server by ID or name. Returns undefined if not found.
   */
  async findByIdOrName(idOrName: string): Promise<McpServer | undefined> {
    const [row] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, idOrName)).limit(1)

    if (row) return rowToMcpServer(row)

    const [byName] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, idOrName)).limit(1)

    return byName ? rowToMcpServer(byName) : undefined
  }

  /**
   * Delete an MCP server and cascade-remove its associations from all agents.
   * Junction table rows are explicitly removed first so we can identify affected
   * agents for event emission; FK ON DELETE CASCADE is a safety net.
   */
  async delete(id: string): Promise<void> {
    await this.getById(id)

    let affectedAgentIds: string[] = []
    await application.get('DbService').withWriteTx(async (tx) => {
      affectedAgentIds = await agentService.removeMcpFromAllAgentsTx(tx, id)
      await tx.delete(mcpServerTable).where(eq(mcpServerTable.id, id))
    })

    // The delete has already committed. `emitAgentUpdatedForIds` opens fresh
    // reads that are not covered by the write-mutex busy-retry, so a transient
    // failure (e.g. SQLITE_BUSY) must NOT reject delete() — the server row is
    // already gone. Log the un-refreshed agents so warm sessions can be
    // reconciled, then swallow.
    try {
      await agentService.emitAgentUpdatedForIds(affectedAgentIds)
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
  async reorder(orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(mcpServerTable).set({ sortOrder: i }).where(eq(mcpServerTable.id, orderedIds[i]))
      }
    })

    logger.info('Reordered MCP servers', { count: orderedIds.length })
  }

  private validateName(name: string): void {
    if (!name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}

export const mcpServerService = new McpServerService()
