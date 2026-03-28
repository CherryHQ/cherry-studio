/**
 * MiniApp Service - handles miniapp CRUD operations
 *
 * Provides business logic for:
 * - MiniApp CRUD operations
 * - Listing with optional filters (status, type)
 * - Status management
 * - Batch reordering
 */

import type { InsertMiniAppRow, MiniAppRow } from '@data/db/schemas/miniapp'
import { type MiniAppStatus, miniappTable, type MiniAppType } from '@data/db/schemas/miniapp'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMiniappDto, UpdateMiniappDto } from '@shared/data/api/schemas/miniapps'
import type { MiniApp } from '@shared/data/types/miniapp'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:MiniAppService')

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
 * Convert database row to MiniApp entity
 */
function rowToMiniApp(row: MiniAppRow): MiniApp {
  const clean = stripNulls(row)
  return {
    ...clean,
    type: clean.type as MiniAppType,
    status: clean.status as MiniAppStatus,
    sortOrder: clean.sortOrder ?? 0,
    supportedRegions: clean.supportedRegions as ('CN' | 'Global')[] | undefined
  }
}

export class MiniAppService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * Get a miniapp by appId
   */
  async getByAppId(appId: string): Promise<MiniApp> {
    const [row] = await this.db.select().from(miniappTable).where(eq(miniappTable.appId, appId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }

    return rowToMiniApp(row)
  }

  /**
   * List miniapps with optional filters
   */
  async list(query: { status?: MiniAppStatus; type?: MiniAppType }): Promise<{ items: MiniApp[]; total: number }> {
    const conditions: SQL[] = []
    if (query.status !== undefined) {
      conditions.push(eq(miniappTable.status, query.status))
    }
    if (query.type !== undefined) {
      conditions.push(eq(miniappTable.type, query.type))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(miniappTable)
        .where(whereClause)
        .orderBy(asc(miniappTable.status), asc(miniappTable.sortOrder)),
      this.db.select({ count: sql<number>`count(*)` }).from(miniappTable).where(whereClause)
    ])

    return {
      items: rows.map(rowToMiniApp),
      total: count
    }
  }

  /**
   * Create a new custom miniapp
   */
  async create(dto: CreateMiniappDto): Promise<MiniApp> {
    // Validate required fields
    this.validateRequired(dto.appId, 'appId')
    this.validateRequired(dto.name, 'name')
    this.validateRequired(dto.url, 'url')

    // Check if appId already exists
    const existing = await this.db.select().from(miniappTable).where(eq(miniappTable.appId, dto.appId)).limit(1)

    if (existing.length > 0) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" already exists`)
    }

    const [row] = await this.db
      .insert(miniappTable)
      .values({
        appId: dto.appId,
        name: dto.name,
        url: dto.url,
        logo: dto.logo ?? null,
        type: 'custom',
        status: 'enabled',
        sortOrder: 0,
        bordered: dto.bordered,
        background: dto.background,
        supportedRegions: dto.supportedRegions,
        configuration: dto.configuration
      })
      .returning()

    logger.info('Created miniapp', { appId: row.appId, name: row.name })

    return rowToMiniApp(row)
  }

  /**
   * Update an existing miniapp
   */
  async update(appId: string, dto: UpdateMiniappDto): Promise<MiniApp> {
    // Verify exists
    await this.getByAppId(appId)

    // Build updates, only include defined fields
    const updates: Partial<InsertMiniAppRow> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.url !== undefined) updates.url = dto.url
    if (dto.logo !== undefined) updates.logo = dto.logo
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.bordered !== undefined) updates.bordered = dto.bordered
    if (dto.background !== undefined) updates.background = dto.background
    if (dto.supportedRegions !== undefined) updates.supportedRegions = dto.supportedRegions
    if (dto.configuration !== undefined) updates.configuration = dto.configuration

    const [row] = await this.db.update(miniappTable).set(updates).where(eq(miniappTable.appId, appId)).returning()

    logger.info('Updated miniapp', { appId, changes: Object.keys(dto) })

    return rowToMiniApp(row)
  }

  /**
   * Delete a miniapp
   * - Custom apps: hard delete
   * - Default apps: not allowed (use updateStatus to disable)
   */
  async delete(appId: string): Promise<void> {
    const existing = await this.getByAppId(appId)

    if (existing.type === 'default') {
      throw DataApiErrorFactory.validation({
        appId: [`Cannot delete default miniapp "${appId}". Use status update to disable it instead.`]
      })
    }

    await this.db.delete(miniappTable).where(eq(miniappTable.appId, appId))

    logger.info('Deleted miniapp', { appId })
  }

  /**
   * Update miniapp status (enabled/disabled/pinned)
   */
  async updateStatus(appId: string, status: MiniAppStatus): Promise<MiniApp> {
    await this.getByAppId(appId)

    const [row] = await this.db.update(miniappTable).set({ status }).where(eq(miniappTable.appId, appId)).returning()

    logger.info('Updated miniapp status', { appId, status })

    return rowToMiniApp(row)
  }

  /**
   * Batch reorder miniapps
   */
  async reorder(items: Array<{ appId: string; sortOrder: number }>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        await tx.update(miniappTable).set({ sortOrder: item.sortOrder }).where(eq(miniappTable.appId, item.appId))
      }
    })

    logger.info('Reordered miniapps', { count: items.length })
  }

  // Private Helpers

  private validateRequired(value: unknown, field: string): void {
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw DataApiErrorFactory.validation({ [field]: [`${field} is required`] })
    }
  }
}

export const miniappService = new MiniAppService()
