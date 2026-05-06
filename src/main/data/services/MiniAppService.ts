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
import { type MiniAppKind, type MiniAppStatus, miniAppTable } from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { type BuiltinMiniAppDefinition, ORIGIN_DEFAULT_MINI_APPS } from '@shared/data/presets/mini-apps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'

import { applyMoves, generateOrderKeySequence, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO, timestampToISOOrUndefined } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

// Build lookup structures from the shared preset data (id -> appId mapping)
const builtinMiniAppMap = new Map<string, BuiltinMiniAppDefinition>(
  ORIGIN_DEFAULT_MINI_APPS.map((app) => [app.id, app])
)

// Pre-generated fractional-indexing keys for builtin apps in their preset order.
// Used to seed default app preference rows on first write within their `status='enabled'` partition.
const BUILTIN_DEFAULT_ORDER_KEYS: ReadonlyArray<string> = generateOrderKeySequence(ORIGIN_DEFAULT_MINI_APPS.length)
const builtinMiniAppDefaultOrderKey = new Map<string, string>(
  ORIGIN_DEFAULT_MINI_APPS.map((app, index) => [app.id, BUILTIN_DEFAULT_ORDER_KEYS[index]])
)

/** Brand a raw DB/app-def string as a MiniAppId. Safe because DB enforces non-empty app_id. */
function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

/**
 * Convert database row to MiniApp entity
 */
function rowToMiniApp(row: MiniAppSelect): MiniApp {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    appId: brandId(clean.appId),
    kind: clean.kind,
    status: clean.status,
    orderKey: clean.orderKey,
    supportedRegions: clean.supportedRegions as ('CN' | 'Global')[] | undefined,
    createdAt: timestampToISO(clean.createdAt),
    updatedAt: timestampToISO(clean.updatedAt)
  }
}

/**
 * Merge a builtin definition with a DB preference row (if exists).
 * If no DB row, uses defaults: status='enabled', orderKey from preset position.
 */
function builtinToMiniApp(def: BuiltinMiniAppDefinition, dbRow?: MiniAppSelect): MiniApp {
  return {
    appId: brandId(def.id),
    kind: 'default',
    status: dbRow ? dbRow.status : 'enabled',
    orderKey: dbRow?.orderKey ?? builtinMiniAppDefaultOrderKey.get(def.id) ?? '',
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
   * Sort: status priority (pinned > enabled > disabled), then orderKey ascending within each status.
   */
  async list(query: { status?: MiniAppStatus; type?: MiniAppKind }): Promise<MiniApp[]> {
    const sortByStatusThenOrderKey = (a: MiniApp, b: MiniApp) => {
      const statusOrder = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const statusDiff = statusOrder(a.status) - statusOrder(b.status)
      if (statusDiff !== 0) return statusDiff
      return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
    }

    // Load all custom apps from DB (always from DB)
    const customConditions: SQL[] = [eq(miniAppTable.kind, 'custom')]
    if (query.status !== undefined) {
      customConditions.push(eq(miniAppTable.status, query.status))
    }
    const customWhere = and(...customConditions)

    const customRows = await this.db.select().from(miniAppTable).where(customWhere).orderBy(asc(miniAppTable.orderKey))

    if (query.type === 'custom') {
      return customRows.map(rowToMiniApp).sort(sortByStatusThenOrderKey)
    }

    // Load DB preference rows for all builtin apps
    const prefRows =
      builtinMiniAppMap.size > 0
        ? await this.db.select().from(miniAppTable).where(eq(miniAppTable.kind, 'default'))
        : []

    const prefMap = new Map<string, MiniAppSelect>()
    for (const row of prefRows) {
      prefMap.set(row.appId, row)
    }

    const allBuiltinDefs = [...builtinMiniAppMap.values()]
    const builtinItems = allBuiltinDefs
      .filter((def) => {
        if (query.status === undefined) return true
        const pref = prefMap.get(def.id)
        const status = pref ? pref.status : 'enabled'
        return status === query.status
      })
      .map((def) => builtinToMiniApp(def, prefMap.get(def.id)))

    const allItems = query.type === 'default' ? builtinItems : [...builtinItems, ...customRows.map(rowToMiniApp)]
    return allItems.sort(sortByStatusThenOrderKey)
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

    const status: MiniAppStatus = 'enabled'
    const row = await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          const inserted = await insertWithOrderKey(
            tx,
            miniAppTable,
            {
              appId: dto.appId,
              name: dto.name,
              url: dto.url,
              logo: dto.logo,
              kind: 'custom',
              status,
              bordered: dto.bordered,
              background: dto.background,
              supportedRegions: dto.supportedRegions,
              configuration: dto.configuration
            },
            {
              pkColumn: miniAppTable.appId,
              position: 'last',
              scope: eq(miniAppTable.status, status)
            }
          )
          return inserted as MiniAppSelect | undefined
        }),
      defaultHandlersFor('MiniApp', dto.appId)
    )

    if (!row) {
      throw DataApiErrorFactory.internal(new Error('Insert returned no rows'), 'MiniApp.create')
    }

    logger.info('Created miniapp', { appId: row.appId, name: row.name, orderKey: row.orderKey })

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
   * Reorder miniapps via fractional-indexing (see data-ordering-guide.md).
   *
   * Partitioned by `status`: each move resolves its scope from the target row's
   * status, and any anchor (`before`/`after`) must live in the same scope.
   * Default-app preference rows are seeded on demand in the same transaction
   * so reordering builtin apps before the user has touched their preferences works.
   *
   * For batches mixing different `status` values, this method splits them into
   * one `applyMoves` call per scope inside a single transaction.
   */
  async reorder(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          // Seed default-app preference rows on demand for any builtin target
          const targetIds = moves.map((m) => m.id)
          const builtinIds = targetIds.filter((id) => builtinMiniAppMap.has(id))
          if (builtinIds.length > 0) {
            const existing = await tx
              .select({ appId: miniAppTable.appId })
              .from(miniAppTable)
              .where(inArray(miniAppTable.appId, builtinIds))
            const existingSet = new Set(existing.map((r) => r.appId))
            const missing = builtinIds.filter((id) => !existingSet.has(id))
            if (missing.length > 0) {
              await tx.insert(miniAppTable).values(
                missing.map((id) => {
                  const def = builtinMiniAppMap.get(id)!
                  return {
                    appId: brandId(def.id),
                    name: def.name,
                    url: def.url,
                    logo: def.logo ?? null,
                    kind: 'default' as const,
                    status: 'enabled' as const,
                    orderKey: builtinMiniAppDefaultOrderKey.get(def.id) ?? '',
                    bordered: def.bordered,
                    background: def.background,
                    supportedRegions: def.supportedRegions,
                    nameKey: def.nameKey
                  } satisfies MiniAppInsert
                })
              )
            }
          }

          // Resolve each target's scope (status), then group moves by scope.
          // Cross-scope batches are an error per applyMoves contract.
          const targetRows = await tx
            .select({ appId: miniAppTable.appId, status: miniAppTable.status })
            .from(miniAppTable)
            .where(inArray(miniAppTable.appId, targetIds))
          const statusByAppId = new Map(targetRows.map((r) => [r.appId, r.status]))

          const movesByStatus = new Map<MiniAppStatus, Array<{ id: string; anchor: OrderRequest }>>()
          for (const m of moves) {
            const status = statusByAppId.get(m.id)
            if (!status) {
              throw DataApiErrorFactory.notFound('MiniApp', m.id)
            }
            const bucket = movesByStatus.get(status) ?? []
            bucket.push(m)
            movesByStatus.set(status, bucket)
          }

          for (const [status, scopedMoves] of movesByStatus) {
            await applyMoves(tx, miniAppTable, scopedMoves, {
              pkColumn: miniAppTable.appId,
              scope: eq(miniAppTable.status, status)
            })
          }
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )

    logger.info('Reordered miniapps', { count: moves.length })
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
            orderKey: builtinMiniAppDefaultOrderKey.get(builtinDef.id) ?? '',
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
