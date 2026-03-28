/**
 * MiniApp Service - handles miniapp CRUD operations
 *
 * Provides business logic for:
 * - MiniApp CRUD operations
 * - Listing with optional filters (status, type)
 * - Merging builtin (preset) apps with DB-stored user preferences
 * - Status management and batch reordering
 *
 * Builtin apps are hardcoded and not stored in the DB until the user changes
 * their preferences (status, sortOrder). The list/get methods merge builtin
 * definitions with DB preference rows to produce a unified MiniApp view.
 */

import { type InsertMiniAppRow, type MiniAppRow } from '@data/db/schemas/miniapp'
import { type MiniAppStatus, miniappTable, type MiniAppType } from '@data/db/schemas/miniapp'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMiniappDto, UpdateMiniappDto } from '@shared/data/api/schemas/miniapps'
import { type BuiltinMiniAppDefinition, ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'
import type { MiniApp } from '@shared/data/types/miniapp'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:MiniAppService')

// Build lookup structures from the shared preset data (id -> appId mapping)
const builtinMiniAppMap = new Map<string, BuiltinMiniAppDefinition>(ORIGIN_DEFAULT_MIN_APPS.map((app) => [app.id, app]))

const builtinMiniAppDefaultSortOrder = new Map<string, number>(
  ORIGIN_DEFAULT_MIN_APPS.map((app, index) => [app.id, index])
)

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
    type: clean.type,
    status: clean.status,
    sortOrder: clean.sortOrder ?? 0,
    supportedRegions: clean.supportedRegions as ('CN' | 'Global')[] | undefined,
    createdAt: clean.createdAt ? new Date(clean.createdAt).toISOString() : undefined,
    updatedAt: clean.updatedAt ? new Date(clean.updatedAt).toISOString() : undefined
  }
}

/**
 * Merge a builtin definition with a DB preference row (if exists).
 * If no DB row, uses defaults: status='enabled', sortOrder=array index.
 */
function builtinToMiniApp(def: BuiltinMiniAppDefinition, dbRow?: MiniAppRow): MiniApp {
  return {
    appId: def.id,
    type: 'default',
    status: dbRow ? dbRow.status : 'enabled',
    sortOrder: dbRow ? (dbRow.sortOrder ?? 0) : (builtinMiniAppDefaultSortOrder.get(def.id) ?? 0),
    name: def.name,
    url: def.url,
    logo: def.logo,
    bordered: def.bordered,
    background: def.background,
    supportedRegions: def.supportedRegions,
    configuration: undefined,
    nameKey: def.nameKey,
    createdAt: dbRow?.createdAt ? new Date(dbRow.createdAt).toISOString() : undefined,
    updatedAt: dbRow?.updatedAt ? new Date(dbRow.updatedAt).toISOString() : undefined
  }
}

export class MiniAppService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * Get a miniapp by appId.
   * For builtin apps, merges hardcoded definition with DB preference row.
   */
  async getByAppId(appId: string): Promise<MiniApp> {
    // Check if it's a builtin app
    const builtinDef = builtinMiniAppMap.get(appId)
    if (builtinDef) {
      const [row] = await this.db.select().from(miniappTable).where(eq(miniappTable.appId, appId)).limit(1)
      return builtinToMiniApp(builtinDef, row ?? undefined)
    }

    // Custom app: must exist in DB
    const [row] = await this.db.select().from(miniappTable).where(eq(miniappTable.appId, appId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }

    return rowToMiniApp(row)
  }

  /**
   * List all miniapps with optional filters.
   * Merges builtin apps (from hardcoded definitions + DB prefs) with custom apps (from DB).
   */
  async list(query: { status?: MiniAppStatus; type?: MiniAppType }): Promise<{ items: MiniApp[]; total: number }> {
    // Load all custom apps from DB (always from DB)
    const customConditions: SQL[] = [eq(miniappTable.type, 'custom')]
    if (query.status !== undefined) {
      customConditions.push(eq(miniappTable.status, query.status))
    }
    const customWhere = and(...customConditions)

    const [customRows, customCountResult] = await Promise.all([
      this.db
        .select()
        .from(miniappTable)
        .where(customWhere)
        .orderBy(asc(miniappTable.status), asc(miniappTable.sortOrder)),
      this.db.select({ count: sql<number>`count(*)` }).from(miniappTable).where(customWhere)
    ])

    // For builtin apps: if type filter is 'custom', skip them entirely
    if (query.type === 'custom') {
      return {
        items: customRows.map(rowToMiniApp),
        total: customCountResult[0].count
      }
    }

    // Load DB preference rows for all builtin apps
    const prefRows =
      builtinMiniAppMap.size > 0
        ? await this.db
            .select()
            .from(miniappTable)
            .where(and(eq(miniappTable.type, 'default')))
        : []

    const prefMap = new Map<string, MiniAppRow>()
    for (const row of prefRows) {
      prefMap.set(row.appId, row)
    }

    // Merge builtin apps
    let builtinItems: MiniApp[]
    const allBuiltinDefs = [...builtinMiniAppMap.values()]
    if (query.status !== undefined) {
      // Filter builtin apps by status from DB prefs
      builtinItems = allBuiltinDefs
        .filter((def) => {
          const pref = prefMap.get(def.id)
          const status = pref ? pref.status : 'enabled'
          return status === query.status
        })
        .map((def) => builtinToMiniApp(def, prefMap.get(def.id)))
        .sort((a: MiniApp, b: MiniApp) => a.sortOrder - b.sortOrder)
    } else {
      builtinItems = allBuiltinDefs
        .map((def) => builtinToMiniApp(def, prefMap.get(def.id)))
        .sort((a: MiniApp, b: MiniApp) => a.sortOrder - b.sortOrder)
    }

    // Combine: pinned first, then enabled, then disabled
    const allItems = [...builtinItems, ...customRows.map(rowToMiniApp)]
    allItems.sort((a, b) => {
      // Sort by status priority: pinned=0, enabled=1, disabled=2
      const statusOrder = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const statusDiff = statusOrder(a.status) - statusOrder(b.status)
      if (statusDiff !== 0) return statusDiff
      return a.sortOrder - b.sortOrder
    })

    return {
      items: allItems,
      total: allItems.length
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

    // Check if appId already exists (both in DB and builtin)
    if (builtinMiniAppMap.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a builtin app and cannot be recreated`)
    }

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
   * Update an existing miniapp.
   * For builtin apps, only certain fields can be updated (status via updateStatus).
   */
  async update(appId: string, dto: UpdateMiniappDto): Promise<MiniApp> {
    const existing = await this.getByAppId(appId)

    if (existing.type === 'default') {
      // For builtin apps, only allow updating preference fields
      // Status changes should go through updateStatus, but allow it here too for flexibility
      await this.ensureDefaultAppPref(appId)
    }

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
   * Lazily creates a DB preference row for builtin apps.
   */
  async updateStatus(appId: string, status: MiniAppStatus): Promise<MiniApp> {
    // Verify app exists (either builtin or in DB)
    await this.getByAppId(appId)

    // Ensure a DB row exists for builtin apps (lazy write)
    await this.ensureDefaultAppPref(appId)

    const [row] = await this.db.update(miniappTable).set({ status }).where(eq(miniappTable.appId, appId)).returning()

    logger.info('Updated miniapp status', { appId, status })

    // Re-merge with builtin definition if applicable
    const builtinDef = builtinMiniAppMap.get(appId)
    if (builtinDef) {
      return builtinToMiniApp(builtinDef, row)
    }
    return rowToMiniApp(row)
  }

  /**
   * Batch reorder miniapps.
   * Lazily creates DB preference rows for builtin apps.
   */
  async reorder(items: Array<{ appId: string; sortOrder: number }>): Promise<void> {
    // Ensure DB rows exist for builtin apps that need reordering
    for (const item of items) {
      if (builtinMiniAppMap.has(item.appId)) {
        await this.ensureDefaultAppPref(item.appId)
      }
    }

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        await tx.update(miniappTable).set({ sortOrder: item.sortOrder }).where(eq(miniappTable.appId, item.appId))
      }
    })

    logger.info('Reordered miniapps', { count: items.length })
  }

  // Private Helpers

  /**
   * Ensure a DB preference row exists for a builtin app.
   * If the app already has a row, this is a no-op.
   * Otherwise, inserts a row with the builtin definition + defaults.
   */
  private async ensureDefaultAppPref(appId: string): Promise<void> {
    const builtinDef = builtinMiniAppMap.get(appId)
    if (!builtinDef) return

    const [existing] = await this.db.select().from(miniappTable).where(eq(miniappTable.appId, appId)).limit(1)

    if (existing) return

    // Insert preference row with builtin defaults
    await this.db.insert(miniappTable).values({
      appId: builtinDef.id,
      name: builtinDef.name,
      url: builtinDef.url,
      logo: builtinDef.logo ?? null,
      type: 'default',
      status: 'enabled',
      sortOrder: builtinMiniAppDefaultSortOrder.get(builtinDef.id) ?? 0,
      bordered: builtinDef.bordered,
      background: builtinDef.background,
      supportedRegions: builtinDef.supportedRegions,
      nameKey: builtinDef.nameKey
    })

    logger.info('Created default app preference row', { appId })
  }

  private validateRequired(value: unknown, field: string): void {
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw DataApiErrorFactory.validation({ [field]: [`${field} is required`] })
    }
  }
}

export const miniappService = new MiniAppService()
