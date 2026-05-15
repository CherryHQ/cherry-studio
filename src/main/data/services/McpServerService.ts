/**
 * MCP Server Service - handles MCP server CRUD operations
 *
 * Provides business logic for:
 * - MCP server CRUD operations
 * - Listing with optional filters (isActive, type)
 */

import { application } from '@application'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMCPServerDto, ListMCPServersQuery, UpdateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MCPServerService')

/**
 * Convert database row to MCPServer entity
 */
function rowToMCPServer(row: typeof mcpServerTable.$inferSelect): MCPServer {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type as MCPServer['type'],
    installSource: clean.installSource as MCPServer['installSource'],
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class MCPServerService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * Get an MCP server by ID
   */
  async getById(id: string): Promise<MCPServer> {
    const [row] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('MCPServer', id)
    }

    return rowToMCPServer(row)
  }

  /**
   * List MCP servers with optional filters
   */
  async list(query: ListMCPServersQuery): Promise<{ items: MCPServer[]; total: number; page: number }> {
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
      items: rows.map(rowToMCPServer),
      total: count,
      page: 1
    }
  }

  /**
   * Create a new MCP server
   */
  async create(dto: CreateMCPServerDto): Promise<MCPServer> {
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

    return rowToMCPServer(row)
  }

  /**
   * Update an existing MCP server
   */
  async update(id: string, dto: UpdateMCPServerDto): Promise<MCPServer> {
    await this.getById(id)

    if (dto.name !== undefined) {
      this.validateName(dto.name)
    }

    const updates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<
      typeof mcpServerTable.$inferInsert
    >

    const [row] = await this.db.update(mcpServerTable).set(updates).where(eq(mcpServerTable.id, id)).returning()

    logger.info('Updated MCP server', { id, changes: Object.keys(dto) })

    return rowToMCPServer(row)
  }

  /**
   * Find an MCP server by ID or name. Returns undefined if not found.
   */
  async findByIdOrName(idOrName: string): Promise<MCPServer | undefined> {
    const [row] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, idOrName)).limit(1)

    if (row) return rowToMCPServer(row)

    const [byName] = await this.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, idOrName)).limit(1)

    return byName ? rowToMCPServer(byName) : undefined
  }

  /**
   * Delete an MCP server
   */
  async delete(id: string): Promise<void> {
    await this.getById(id)

    await this.db.delete(mcpServerTable).where(eq(mcpServerTable.id, id))

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

export const mcpServerService = new MCPServerService()
