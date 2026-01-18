/**
 * WebSearch Provider Service - handles provider CRUD and connection testing
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Data transformation (DB format <-> API format)
 * - Connection testing
 */

import { dbService } from '@data/db/DbService'
import { websearchProviderTable } from '@data/db/schemas/websearchProvider'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  CreateWebSearchProviderDto,
  TestProviderResponse,
  UpdateWebSearchProviderDto,
  WebSearchProvider
} from '@shared/data/api/schemas/websearch-providers'
import { count, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:WebSearchProviderService')

/**
 * Convert database row to WebSearchProvider entity
 */
function rowToProvider(row: typeof websearchProviderTable.$inferSelect): WebSearchProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as WebSearchProvider['type'],
    apiKey: row.apiKey,
    apiHost: row.apiHost,
    engines: row.engines ?? null,
    usingBrowser: row.usingBrowser ?? false,
    basicAuthUsername: row.basicAuthUsername,
    basicAuthPassword: row.basicAuthPassword,
    createdAt: row.createdAt ?? Date.now(),
    updatedAt: row.updatedAt ?? Date.now()
  }
}

export class WebSearchProviderService {
  private static instance: WebSearchProviderService

  private constructor() {}

  public static getInstance(): WebSearchProviderService {
    if (!WebSearchProviderService.instance) {
      WebSearchProviderService.instance = new WebSearchProviderService()
    }
    return WebSearchProviderService.instance
  }

  /**
   * List all providers with pagination
   */
  async list(params: { page: number; limit: number }): Promise<OffsetPaginationResponse<WebSearchProvider>> {
    const db = dbService.getDb()
    const { page, limit } = params
    const offset = (page - 1) * limit

    const [rows, countResult] = await Promise.all([
      db.select().from(websearchProviderTable).limit(limit).offset(offset),
      db.select({ count: count() }).from(websearchProviderTable)
    ])

    return {
      items: rows.map(rowToProvider),
      total: countResult[0]?.count ?? 0,
      page
    }
  }

  /**
   * Get a provider by ID
   */
  async getById(id: string): Promise<WebSearchProvider> {
    const db = dbService.getDb()

    const [row] = await db.select().from(websearchProviderTable).where(eq(websearchProviderTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('WebSearchProvider', id)
    }

    return rowToProvider(row)
  }

  /**
   * Create a new provider
   */
  async create(dto: CreateWebSearchProviderDto): Promise<WebSearchProvider> {
    const db = dbService.getDb()

    // Validate required fields
    if (!dto.id?.trim()) {
      throw DataApiErrorFactory.validation({ id: ['ID is required'] })
    }
    if (!dto.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
    if (!dto.type || !['api', 'local'].includes(dto.type)) {
      throw DataApiErrorFactory.validation({ type: ['Type must be "api" or "local"'] })
    }

    // Check ID uniqueness
    const existing = await db
      .select({ id: websearchProviderTable.id })
      .from(websearchProviderTable)
      .where(eq(websearchProviderTable.id, dto.id))
      .limit(1)

    if (existing.length > 0) {
      throw DataApiErrorFactory.invalidOperation('create provider', `Provider with ID "${dto.id}" already exists`)
    }

    const [row] = await db
      .insert(websearchProviderTable)
      .values({
        id: dto.id,
        name: dto.name,
        type: dto.type,
        apiKey: dto.apiKey ?? null,
        apiHost: dto.apiHost ?? null,
        engines: dto.engines ?? null,
        usingBrowser: dto.usingBrowser ?? false,
        basicAuthUsername: dto.basicAuthUsername ?? null,
        basicAuthPassword: dto.basicAuthPassword ?? null
      })
      .returning()

    logger.info('Created websearch provider', { id: row.id, type: dto.type })

    return rowToProvider(row)
  }

  /**
   * Update a provider
   */
  async update(id: string, dto: UpdateWebSearchProviderDto): Promise<WebSearchProvider> {
    const db = dbService.getDb()

    // Verify provider exists
    await this.getById(id)

    // Validate type if provided
    if (dto.type !== undefined && !['api', 'local'].includes(dto.type)) {
      throw DataApiErrorFactory.validation({ type: ['Type must be "api" or "local"'] })
    }

    // Build update object
    const updates: Partial<typeof websearchProviderTable.$inferInsert> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.type !== undefined) updates.type = dto.type
    if (dto.apiKey !== undefined) updates.apiKey = dto.apiKey
    if (dto.apiHost !== undefined) updates.apiHost = dto.apiHost
    if (dto.engines !== undefined) updates.engines = dto.engines
    if (dto.usingBrowser !== undefined) updates.usingBrowser = dto.usingBrowser
    if (dto.basicAuthUsername !== undefined) updates.basicAuthUsername = dto.basicAuthUsername
    if (dto.basicAuthPassword !== undefined) updates.basicAuthPassword = dto.basicAuthPassword

    const [row] = await db
      .update(websearchProviderTable)
      .set(updates)
      .where(eq(websearchProviderTable.id, id))
      .returning()

    logger.info('Updated websearch provider', { id, changes: Object.keys(dto) })

    return rowToProvider(row)
  }

  /**
   * Delete a provider
   */
  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    // Verify provider exists
    await this.getById(id)

    await db.delete(websearchProviderTable).where(eq(websearchProviderTable.id, id))

    logger.info('Deleted websearch provider', { id })
  }

  /**
   * Test provider connection
   *
   * For API type: Attempts to make a test request to verify credentials
   * For Local type: Validates URL template format
   */
  async testConnection(id: string): Promise<TestProviderResponse> {
    const provider = await this.getById(id)
    const startTime = Date.now()

    try {
      if (provider.type === 'local') {
        // For local providers, validate URL template
        if (!provider.apiHost?.includes('%s')) {
          return {
            success: false,
            message: 'URL template must contain %s placeholder'
          }
        }

        return {
          success: true,
          message: 'URL template is valid',
          latencyMs: Date.now() - startTime
        }
      }

      // For API providers, we would make a test request here
      // This is a placeholder - actual implementation depends on provider-specific APIs
      if (!provider.apiHost && !provider.apiKey) {
        return {
          success: false,
          message: 'API host or API key is required for API type providers'
        }
      }

      // TODO: Implement actual connection testing for each provider type
      // For now, return success if basic configuration is present
      return {
        success: true,
        message: 'Configuration is valid (connection test not implemented)',
        latencyMs: Date.now() - startTime
      }
    } catch (error) {
      logger.error('Provider connection test failed', { id, error })
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed'
      }
    }
  }
}

export const websearchProviderService = WebSearchProviderService.getInstance()
