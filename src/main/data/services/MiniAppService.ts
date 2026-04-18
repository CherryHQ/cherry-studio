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
import { type MiniAppInsert, type MiniAppRegion, type MiniAppSelect } from '@data/db/schemas/miniapp'
import { type MiniAppKind, type MiniAppStatus, miniAppTable } from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { type BuiltinMiniAppDefinition, ORIGIN_DEFAULT_MINI_APPS } from '@shared/data/presets/mini-apps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:MiniAppService')

// Build lookup structures from the shared preset data (id -> appId mapping)
const builtinMiniAppMap = new Map<string, BuiltinMiniAppDefinition>(
  ORIGIN_DEFAULT_MINI_APPS.map((app) => [app.id, app])
)

const builtinMiniAppDefaultSortOrder = new Map<string, number>(
  ORIGIN_DEFAULT_MINI_APPS.map((app, index) => [app.id, index])
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

const VALID_REGIONS = new Set<string>(['CN', 'Global'])

/**
 * Validate and parse supportedRegions from a DB row.
 * Mirrors the write-side validation in MiniAppMappings.toNullableRegions.
 */
function parseRegions(raw: unknown): ('CN' | 'Global')[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const regions = raw.filter((r): r is MiniAppRegion => typeof r === 'string' && VALID_REGIONS.has(r))
  return regions.length > 0 ? regions : undefined
}

/** Brand a raw DB/app-def string as a MiniAppId. Safe because DB enforces non-empty app_id. */
function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

/**
 * Convert database row to MiniApp entity
 */
function rowToMiniApp(row: MiniAppSelect): MiniApp {
  const clean = stripNulls(row)
  return {
    ...clean,
    appId: brandId(clean.appId),
    kind: clean.kind,
    status: clean.status,
    sortOrder: clean.sortOrder ?? 0,
    supportedRegions: parseRegions(clean.supportedRegions),
    createdAt: clean.createdAt ? new Date(clean.createdAt).toISOString() : undefined,
    updatedAt: clean.updatedAt ? new Date(clean.updatedAt).toISOString() : undefined
  }
}

/**
 * Merge a builtin definition with a DB preference row (if exists).
 * If no DB row, uses defaults: status='enabled', sortOrder=array index.
 */
function builtinToMiniApp(def: BuiltinMiniAppDefinition, dbRow?: MiniAppSelect): MiniApp {
  return {
    appId: brandId(def.id),
    kind: 'default',
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
      const [row] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)
      return builtinToMiniApp(builtinDef, row ?? undefined)
    }

    // Custom app: must exist in DB
    const [row] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }

    return rowToMiniApp(row)
  }

  /**
   * List all miniapps with optional filters.
   * Merges builtin apps (from hardcoded definitions + DB prefs) with custom apps (from DB).
   */
  async list(query: { status?: MiniAppStatus; type?: MiniAppKind }): Promise<MiniApp[]> {
    // Load all custom apps from DB (always from DB)
    const customConditions: SQL[] = [eq(miniAppTable.kind, 'custom')]
    if (query.status !== undefined) {
      customConditions.push(eq(miniAppTable.status, query.status))
    }
    const customWhere = and(...customConditions)

    const customRows = await this.db.select().from(miniAppTable).where(customWhere).orderBy(asc(miniAppTable.sortOrder))

    if (query.type === 'custom') {
      const items = customRows.map(rowToMiniApp)
      // Sort by status priority: pinned=0, enabled=1, disabled=2
      const statusOrder = (s: MiniApp['status']) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      items.sort((a, b) => {
        const diff = statusOrder(a.status) - statusOrder(b.status)
        if (diff !== 0) return diff
        return a.sortOrder - b.sortOrder
      })
      return items
    }

    // Load DB preference rows for all builtin apps
    const prefRows =
      builtinMiniAppMap.size > 0
        ? await this.db
            .select()
            .from(miniAppTable)
            .where(and(eq(miniAppTable.kind, 'default')))
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

    const allItems = query.type === 'default' ? [...builtinItems] : [...builtinItems, ...customRows.map(rowToMiniApp)]
    allItems.sort((a, b) => {
      // Sort by status priority: pinned=0, enabled=1, disabled=2
      const statusOrder = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const statusDiff = statusOrder(a.status) - statusOrder(b.status)
      if (statusDiff !== 0) return statusDiff
      return a.sortOrder - b.sortOrder
    })

    return allItems
  }

  /**
   * Create a new custom miniapp.
   *
   * The builtin-conflict check is application-level (SQLite has no knowledge
   * of builtin app IDs), so it must stay in code. DB-level uniqueness of
   * custom appIds is enforced by the UNIQUE PRIMARY KEY on miniAppTable.appId
   * and translated to a 409 CONFLICT via withSqliteErrors — no select-then-
   * insert pre-check is used, so two concurrent creates with the same appId
   * yield one 201 and one 409 instead of one 201 and one 500.
   */
  async create(dto: CreateMiniAppDto): Promise<MiniApp> {
    if (builtinMiniAppMap.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a builtin app and cannot be recreated`)
    }

    // Calculate next sortOrder: offset by builtin apps count to avoid collisions
    const builtinCount = builtinMiniAppMap.size
    const maxSortOrderResult = await this.db
      .select({ maxSortOrder: miniAppTable.sortOrder })
      .from(miniAppTable)
      .orderBy(desc(miniAppTable.sortOrder))
      .limit(1)

    const maxDbSortOrder = maxSortOrderResult[0]?.maxSortOrder ?? builtinCount - 1
    const nextSortOrder = maxDbSortOrder + 1

    const [row] = await withSqliteErrors(
      () =>
        this.db
          .insert(miniAppTable)
          .values({
            appId: dto.appId,
            name: dto.name,
            url: dto.url,
            logo: dto.logo,
            kind: 'custom',
            status: 'enabled',
            sortOrder: nextSortOrder,
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

    logger.info('Created miniapp', { appId: row.appId, name: row.name, sortOrder: nextSortOrder })

    return rowToMiniApp(row)
  }

  /**
   * Update an existing miniapp.
   * For builtin (default) apps, only `status` is updatable via this method.
   * Use `reorder()` to change `sortOrder`. Preset fields (name, url, logo)
   * are immutable — they come from code definitions.
   */
  async update(appId: string, dto: UpdateMiniAppDto): Promise<MiniApp> {
    const existing = await this.getByAppId(appId)

    // Build updates map before any side effects
    const updates: Partial<MiniAppInsert> = {}

    if (existing.kind === 'default') {
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

    // Validate before touching the DB (prevents ghost row on ensureDefaultAppPref)
    const appliedChanges = Object.keys(updates)
    if (appliedChanges.length === 0) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for ${existing.kind} miniapp "${appId}"`] },
        `No applicable fields to update`
      )
    }

    let row: MiniAppSelect | undefined

    if (existing.kind === 'default') {
      // Atomic: ensure preference row + update in one transaction
      await withSqliteErrors(
        () =>
          this.db.transaction(async (tx) => {
            await this.ensureDefaultAppPref(appId, tx)
            ;[row] = await tx.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning()
          }),
        defaultHandlersFor('MiniApp', appId)
      )
    } else {
      ;[row] = await withSqliteErrors(
        () => this.db.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning(),
        defaultHandlersFor('MiniApp', appId)
      )
    }

    if (!row) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }

    logger.info('Updated miniapp', { appId, changes: appliedChanges })

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

    if (existing.kind === 'default') {
      throw DataApiErrorFactory.validation({
        appId: [`Cannot delete default miniapp "${appId}". Use status update to disable it instead.`]
      })
    }

    await withSqliteErrors(
      () => this.db.delete(miniAppTable).where(eq(miniAppTable.appId, appId)),
      defaultHandlersFor('MiniApp', appId)
    )

    logger.info('Deleted miniapp', { appId })
  }

  /**
   * Batch reorder miniapps.
   */
  async reorder(items: Array<{ appId: string; sortOrder: number }>): Promise<{ skipped: string[] }> {
    let skipped: string[] = []

    await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          // Batch-ensure DB rows exist for all builtin apps in the reorder list
          const builtinAppIds = items.map((item) => item.appId).filter((id) => builtinMiniAppMap.has(id))

          if (builtinAppIds.length > 0) {
            // Batch-query existing rows for builtin apps
            const existingRows = await tx
              .select({ appId: miniAppTable.appId })
              .from(miniAppTable)
              .where(inArray(miniAppTable.appId, builtinAppIds))

            const existingSet = new Set(existingRows.map((r) => r.appId))
            const missingIds = builtinAppIds.filter((id) => !existingSet.has(id))

            // Batch-insert missing builtin app preference rows
            if (missingIds.length > 0) {
              const valuesToInsert = missingIds.map((id) => {
                const def = builtinMiniAppMap.get(id)!
                return {
                  appId: brandId(def.id),
                  name: def.name,
                  url: def.url,
                  logo: def.logo ?? null,
                  kind: 'default' as const,
                  status: 'enabled' as const,
                  sortOrder: builtinMiniAppDefaultSortOrder.get(def.id) ?? 0,
                  bordered: def.bordered,
                  background: def.background,
                  supportedRegions: def.supportedRegions,
                  nameKey: def.nameKey
                }
              })
              await tx.insert(miniAppTable).values(valuesToInsert)
            }
          }

          // Update sort orders
          skipped = []
          for (const item of items) {
            const result = await tx
              .update(miniAppTable)
              .set({ sortOrder: item.sortOrder })
              .where(eq(miniAppTable.appId, item.appId))
              .returning({ appId: miniAppTable.appId })
            if (result.length === 0) {
              skipped.push(item.appId)
            }
          }
          if (skipped.length > 0) {
            logger.warn('Reorder skipped non-existent app IDs', { skipped })
          }
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )

    logger.info('Reordered miniapps', { count: items.length, skipped: skipped.length })
    return { skipped }
  }

  /**
   * Reset all builtin (default) app preferences to factory defaults.
   * Deletes all DB preference rows for type='default', so that subsequent
   * list/get calls will fall back to hardcoded builtin definitions.
   */
  async resetDefaults(): Promise<void> {
    await withSqliteErrors(
      () => this.db.delete(miniAppTable).where(eq(miniAppTable.kind, 'default')),
      defaultHandlersFor('MiniApp', 'defaults')
    )
    logger.info('Reset all default app preferences to factory defaults')
  }

  // Private Helpers

  /**
   * Ensure a DB preference row exists for a builtin app.
   * Accepts an optional transaction so callers can make this atomic with
   * subsequent writes (e.g. update).
   */
  private async ensureDefaultAppPref(appId: string, tx?: any): Promise<void> {
    const builtinDef = builtinMiniAppMap.get(appId)
    if (!builtinDef) return

    const db = tx ?? this.db

    await withSqliteErrors(
      () =>
        db
          .insert(miniAppTable)
          .values({
            appId: builtinDef.id,
            name: builtinDef.name,
            url: builtinDef.url,
            logo: builtinDef.logo ?? null,
            kind: 'default',
            status: 'enabled',
            sortOrder: builtinMiniAppDefaultSortOrder.get(builtinDef.id) ?? 0,
            bordered: builtinDef.bordered,
            background: builtinDef.background,
            supportedRegions: builtinDef.supportedRegions,
            nameKey: builtinDef.nameKey
          })
          .onConflictDoNothing(),
      defaultHandlersFor('MiniApp', appId)
    )

    logger.debug('Ensured default app preference row', { appId })
  }
}

export const miniAppService = new MiniAppService()
