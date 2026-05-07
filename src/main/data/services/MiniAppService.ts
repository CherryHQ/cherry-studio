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

import { application } from '@application'
import { type MiniAppInsert, type MiniAppSelect } from '@data/db/schemas/miniapp'
import { type MiniAppStatus, miniappTable, type MiniAppType } from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { CreateMiniappDto, UpdateMiniappDto } from '@shared/data/api/schemas/miniapps'
import { type BuiltinMiniAppDefinition, ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'
import type { MiniApp } from '@shared/data/types/miniapp'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO, timestampToISOOrUndefined } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

// Build lookup structures from the shared preset data (id -> appId mapping)
const builtinMiniAppMap = new Map<string, BuiltinMiniAppDefinition>(ORIGIN_DEFAULT_MIN_APPS.map((app) => [app.id, app]))

const builtinMiniAppDefaultSortOrder = new Map<string, number>(
  ORIGIN_DEFAULT_MIN_APPS.map((app, index) => [app.id, index])
)

/**
 * Convert database row to MiniApp entity
 */
function rowToMiniApp(row: MiniAppSelect): MiniApp {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type,
    status: clean.status,
    sortOrder: row.sortOrder,
    supportedRegions: clean.supportedRegions as ('CN' | 'Global')[] | undefined,
    createdAt: timestampToISO(clean.createdAt),
    updatedAt: timestampToISO(clean.updatedAt)
  }
}

/**
 * Merge a builtin definition with a DB preference row (if exists).
 * If no DB row, uses defaults: status='enabled', sortOrder=array index.
 */
function builtinToMiniApp(def: BuiltinMiniAppDefinition, dbRow?: MiniAppSelect): MiniApp {
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
    createdAt: timestampToISOOrUndefined(dbRow?.createdAt),
    updatedAt: timestampToISOOrUndefined(dbRow?.updatedAt)
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
   * Returns OffsetPaginationResponse for consistency with other list endpoints.
   */
  async list(query: { status?: MiniAppStatus; type?: MiniAppType }): Promise<OffsetPaginationResponse<MiniApp>> {
    // Load all custom apps from DB (always from DB)
    const customConditions: SQL[] = [eq(miniappTable.type, 'custom')]
    if (query.status !== undefined) {
      customConditions.push(eq(miniappTable.status, query.status))
    }
    const customWhere = and(...customConditions)

    // I12: Removed redundant COUNT query — customRows.length gives count directly
    const customRows = await this.db
      .select()
      .from(miniappTable)
      .where(customWhere)
      .orderBy(asc(miniappTable.status), asc(miniappTable.sortOrder))

    // N6: Handle type filters — 'custom' returns only DB custom apps, 'default' returns only builtins
    if (query.type === 'custom') {
      const items = customRows.map(rowToMiniApp)
      return {
        items,
        total: items.length,
        page: 1
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

    const prefMap = new Map<string, MiniAppSelect>()
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

    // N6: Combine — skip custom rows when type filter is 'default'
    const allItems = query.type === 'default' ? [...builtinItems] : [...builtinItems, ...customRows.map(rowToMiniApp)]
    allItems.sort((a, b) => {
      // Sort by status priority: pinned=0, enabled=1, disabled=2
      const statusOrder = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const statusDiff = statusOrder(a.status) - statusOrder(b.status)
      if (statusDiff !== 0) return statusDiff
      return a.sortOrder - b.sortOrder
    })

    return {
      items: allItems,
      total: allItems.length,
      page: 1
    }
  }

  /**
   * Create a new custom miniapp.
   *
   * The builtin-conflict check is application-level (SQLite has no knowledge
   * of builtin app IDs), so it must stay in code. DB-level uniqueness of
   * custom appIds is enforced by the UNIQUE PRIMARY KEY on miniappTable.appId
   * and translated to a 409 CONFLICT via withSqliteErrors — no select-then-
   * insert pre-check is used, so two concurrent creates with the same appId
   * yield one 201 and one 409 instead of one 201 and one 500.
   */
  async create(dto: CreateMiniappDto): Promise<MiniApp> {
    if (builtinMiniAppMap.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a builtin app and cannot be recreated`)
    }

    const [row] = await withSqliteErrors(
      () =>
        this.db
          .insert(miniappTable)
          .values({
            appId: dto.appId,
            name: dto.name,
            url: dto.url,
            logo: dto.logo,
            type: 'custom',
            status: 'enabled',
            sortOrder: 0,
            bordered: dto.bordered,
            background: dto.background,
            supportedRegions: dto.supportedRegions,
            configuration: dto.configuration
          })
          .returning(),
      defaultHandlersFor('MiniApp', dto.appId)
    )

    if (!row) {
      throw DataApiErrorFactory.internal(new Error('Insert returned no rows'), 'MiniApp.create')
    }

    logger.info('Created miniapp', { appId: row.appId, name: row.name })

    return rowToMiniApp(row)
  }

  /**
   * Update an existing miniapp.
   * For builtin (default) apps, only preference fields (status, sortOrder) are updatable.
   * Preset fields (name, url, logo) are immutable — they come from code definitions.
   */
  async update(appId: string, dto: UpdateMiniappDto): Promise<MiniApp> {
    const existing = await this.getByAppId(appId)

    if (existing.type === 'default') {
      // For builtin apps, only allow updating preference fields
      await this.ensureDefaultAppPref(appId)
    }

    // I5: For default apps, only allow preference fields; ignore preset fields
    const updates: Partial<MiniAppInsert> = {}

    if (existing.type === 'default') {
      // Only preference fields for default apps
      if (dto.status !== undefined) updates.status = dto.status
    } else {
      // All fields for custom apps
      if (dto.name !== undefined) updates.name = dto.name
      if (dto.url !== undefined) updates.url = dto.url
      if (dto.logo !== undefined) updates.logo = dto.logo
      if (dto.status !== undefined) updates.status = dto.status
      if (dto.bordered !== undefined) updates.bordered = dto.bordered
      if (dto.background !== undefined) updates.background = dto.background
      if (dto.supportedRegions !== undefined) updates.supportedRegions = dto.supportedRegions
      if (dto.configuration !== undefined) updates.configuration = dto.configuration
    }

    // N5: Reject empty updates (e.g. non-status fields on a default app)
    const appliedChanges = Object.keys(updates)
    if (appliedChanges.length === 0) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for ${existing.type} miniapp "${appId}"`] },
        `No applicable fields to update`
      )
    }

    const [row] = await this.db.update(miniappTable).set(updates).where(eq(miniappTable.appId, appId)).returning()

    // I2: Validate .returning() result
    if (!row) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }

    logger.info('Updated miniapp', { appId, changes: appliedChanges })

    // I1: Return merged preset for builtin apps
    const builtinDef = builtinMiniAppMap.get(appId)
    if (builtinDef) {
      return builtinToMiniApp(builtinDef, row)
    }
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
   * Batch reorder miniapps.
   * I3: All ensureDefaultAppPref calls and updates happen inside a single transaction.
   */
  async reorder(items: Array<{ appId: string; sortOrder: number }>): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Batch-ensure DB rows exist for all builtin apps in the reorder list
      const builtinAppIds = items.map((item) => item.appId).filter((id) => builtinMiniAppMap.has(id))

      if (builtinAppIds.length > 0) {
        // Batch-query existing rows for builtin apps
        const existingRows = await tx
          .select({ appId: miniappTable.appId })
          .from(miniappTable)
          .where(inArray(miniappTable.appId, builtinAppIds))

        const existingSet = new Set(existingRows.map((r) => r.appId))
        const missingIds = builtinAppIds.filter((id) => !existingSet.has(id))

        // Batch-insert missing builtin app preference rows
        if (missingIds.length > 0) {
          const valuesToInsert = missingIds.map((id) => {
            const def = builtinMiniAppMap.get(id)!
            return {
              appId: def.id,
              name: def.name,
              url: def.url,
              logo: def.logo ?? null,
              type: 'default' as const,
              status: 'enabled' as const,
              sortOrder: builtinMiniAppDefaultSortOrder.get(def.id) ?? 0,
              bordered: def.bordered,
              background: def.background,
              supportedRegions: def.supportedRegions,
              nameKey: def.nameKey
            }
          })
          await tx.insert(miniappTable).values(valuesToInsert)
        }
      }

      // Update sort orders
      const skipped: string[] = []
      for (const item of items) {
        const result = await tx
          .update(miniappTable)
          .set({ sortOrder: item.sortOrder })
          .where(eq(miniappTable.appId, item.appId))
          .returning({ appId: miniappTable.appId })
        if (result.length === 0) {
          skipped.push(item.appId)
        }
      }
      if (skipped.length > 0) {
        logger.warn('Reorder skipped non-existent app IDs', { skipped })
      }
    })

    logger.info('Reordered miniapps', { count: items.length })
  }

  /**
   * Reset all builtin (default) app preferences to factory defaults.
   * Deletes all DB preference rows for type='default', so that subsequent
   * list/get calls will fall back to hardcoded builtin definitions.
   */
  async resetDefaults(): Promise<void> {
    await this.db.delete(miniappTable).where(eq(miniappTable.type, 'default'))
    logger.info('Reset all default app preferences to factory defaults')
  }

  // Private Helpers

  /**
   * Ensure a DB preference row exists for a builtin app.
   * I4: Uses INSERT ... ON CONFLICT DO NOTHING to avoid TOCTOU race.
   */
  private async ensureDefaultAppPref(appId: string): Promise<void> {
    const builtinDef = builtinMiniAppMap.get(appId)
    if (!builtinDef) return

    await this.db
      .insert(miniappTable)
      .values({
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
      .onConflictDoNothing()

    logger.debug('Ensured default app preference row', { appId })
  }
}

export const miniappService = new MiniAppService()
