/**
 * MCP Server Service - handles MCP server CRUD operations
 *
 * Provides business logic for:
 * - MCP server CRUD operations
 * - Listing with optional filters (isActive, type)
 */

import { dbService } from '@data/db/DbService'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMCPServerDto, ListMCPServersQuery, UpdateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { and, eq, type SQL, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:MCPServerService')

/**
 * Strip null values from an object, converting them to undefined.
 * This bridges the gap between SQLite NULL and TypeScript optional fields.
 */
function stripNulls<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], null> } {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    result[key] = value === null ? undefined : value
  }
  return result as { [K in keyof T]: Exclude<T[K], null> }
}

/**
 * Convert database row to MCPServer entity
 */
function rowToMCPServer(row: typeof mcpServerTable.$inferSelect): MCPServer {
  const clean = stripNulls(row)
  return {
    ...clean,
    type: clean.type as MCPServer['type'],
    installSource: clean.installSource as MCPServer['installSource'],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class MCPServerService {
  private static instance: MCPServerService

  private constructor() {}

  public static getInstance(): MCPServerService {
    if (!MCPServerService.instance) {
      MCPServerService.instance = new MCPServerService()
    }
    return MCPServerService.instance
  }

  /**
   * Get an MCP server by ID
   */
  async getById(id: string): Promise<MCPServer> {
    const db = dbService.getDb()

    const [row] = await db.select().from(mcpServerTable).where(eq(mcpServerTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('MCPServer', id)
    }

    return rowToMCPServer(row)
  }

  /**
   * List MCP servers with optional filters
   */
  async list(query: ListMCPServersQuery): Promise<{ items: MCPServer[]; total: number; page: number }> {
    const db = dbService.getDb()

    const conditions: SQL[] = []
    if (query.isActive !== undefined) {
      conditions.push(eq(mcpServerTable.isActive, query.isActive))
    }
    if (query.type !== undefined) {
      conditions.push(eq(mcpServerTable.type, query.type))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(mcpServerTable).where(whereClause),
      db.select({ count: sql<number>`count(*)` }).from(mcpServerTable).where(whereClause)
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

    const db = dbService.getDb()

    const [row] = await db
      .insert(mcpServerTable)
      .values({
        name: dto.name,
        type: dto.type,
        description: dto.description,
        baseUrl: dto.baseUrl,
        command: dto.command,
        registryUrl: dto.registryUrl,
        args: dto.args,
        env: dto.env,
        headers: dto.headers,
        provider: dto.provider,
        providerUrl: dto.providerUrl,
        logoUrl: dto.logoUrl,
        tags: dto.tags,
        longRunning: dto.longRunning,
        timeout: dto.timeout,
        dxtVersion: dto.dxtVersion,
        dxtPath: dto.dxtPath,
        reference: dto.reference,
        searchKey: dto.searchKey,
        configSample: dto.configSample,
        disabledTools: dto.disabledTools,
        disabledAutoApproveTools: dto.disabledAutoApproveTools,
        shouldConfig: dto.shouldConfig,
        isActive: dto.isActive ?? false,
        installSource: dto.installSource,
        isTrusted: dto.isTrusted,
        trustedAt: dto.trustedAt,
        installedAt: dto.installedAt
      })
      .returning()

    logger.info('Created MCP server', { id: row.id, name: row.name })

    return rowToMCPServer(row)
  }

  /**
   * Update an existing MCP server
   */
  async update(id: string, dto: UpdateMCPServerDto): Promise<MCPServer> {
    // Verify server exists
    await this.getById(id)

    // Validate name if provided
    if (dto.name !== undefined) {
      this.validateName(dto.name)
    }

    const db = dbService.getDb()

    const updates: Partial<typeof mcpServerTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.type !== undefined) updates.type = dto.type
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.baseUrl !== undefined) updates.baseUrl = dto.baseUrl
    if (dto.command !== undefined) updates.command = dto.command
    if (dto.registryUrl !== undefined) updates.registryUrl = dto.registryUrl
    if (dto.args !== undefined) updates.args = dto.args
    if (dto.env !== undefined) updates.env = dto.env
    if (dto.headers !== undefined) updates.headers = dto.headers
    if (dto.provider !== undefined) updates.provider = dto.provider
    if (dto.providerUrl !== undefined) updates.providerUrl = dto.providerUrl
    if (dto.logoUrl !== undefined) updates.logoUrl = dto.logoUrl
    if (dto.tags !== undefined) updates.tags = dto.tags
    if (dto.longRunning !== undefined) updates.longRunning = dto.longRunning
    if (dto.timeout !== undefined) updates.timeout = dto.timeout
    if (dto.dxtVersion !== undefined) updates.dxtVersion = dto.dxtVersion
    if (dto.dxtPath !== undefined) updates.dxtPath = dto.dxtPath
    if (dto.reference !== undefined) updates.reference = dto.reference
    if (dto.searchKey !== undefined) updates.searchKey = dto.searchKey
    if (dto.configSample !== undefined) updates.configSample = dto.configSample
    if (dto.disabledTools !== undefined) updates.disabledTools = dto.disabledTools
    if (dto.disabledAutoApproveTools !== undefined) updates.disabledAutoApproveTools = dto.disabledAutoApproveTools
    if (dto.shouldConfig !== undefined) updates.shouldConfig = dto.shouldConfig
    if (dto.isActive !== undefined) updates.isActive = dto.isActive
    if (dto.installSource !== undefined) updates.installSource = dto.installSource
    if (dto.isTrusted !== undefined) updates.isTrusted = dto.isTrusted
    if (dto.trustedAt !== undefined) updates.trustedAt = dto.trustedAt
    if (dto.installedAt !== undefined) updates.installedAt = dto.installedAt

    const [row] = await db.update(mcpServerTable).set(updates).where(eq(mcpServerTable.id, id)).returning()

    logger.info('Updated MCP server', { id, changes: Object.keys(dto) })

    return rowToMCPServer(row)
  }

  /**
   * Find an MCP server by ID or name. Returns undefined if not found.
   */
  async findByIdOrName(idOrName: string): Promise<MCPServer | undefined> {
    const db = dbService.getDb()

    const [row] = await db.select().from(mcpServerTable).where(eq(mcpServerTable.id, idOrName)).limit(1)

    if (row) return rowToMCPServer(row)

    const [byName] = await db.select().from(mcpServerTable).where(eq(mcpServerTable.name, idOrName)).limit(1)

    return byName ? rowToMCPServer(byName) : undefined
  }

  /**
   * Delete an MCP server
   */
  async delete(id: string): Promise<void> {
    // Verify server exists
    await this.getById(id)

    const db = dbService.getDb()

    await db.delete(mcpServerTable).where(eq(mcpServerTable.id, id))

    logger.info('Deleted MCP server', { id })
  }

  private validateName(name: string): void {
    if (!name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}

export const mcpServerService = MCPServerService.getInstance()
