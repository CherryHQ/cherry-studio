/**
 * MiniApp Service - handles miniapp CRUD operations.
 *
 * Owns the `mini_app` SQLite table. Mirrors {@link ProviderService}:
 * uniform CRUD over rows, with row-shape policy enforced via column checks
 * (`presetMiniAppId`). Preset display fields are seeded by {@link MiniAppSeeder}
 * at boot and refreshed on every re-run (no UI exposes them for editing).
 *
 * Layered preset pattern:
 *   - presetMiniAppId !== null  →  inherits from a {@link PRESETS_MINI_APPS} entry
 *   - presetMiniAppId === null  →  pure custom app
 */

import { application } from '@application'
import { type InsertMiniAppRow, type MiniAppRow, type MiniAppStatus, miniAppTable } from '@data/db/schemas/miniApp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { and, asc, desc, eq, gt, lt, ne } from 'drizzle-orm'

import { applyScopedMoves, generateOrderKeyBetween, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

/** Preset id set, used for write-time collision rejection. */
const presetMiniAppIdSet: ReadonlySet<string> = new Set(PRESETS_MINI_APPS.map((p) => p.id))
const customMutableFields = ['name', 'url', 'logo'] as const
const visibleStatuses: ReadonlySet<MiniAppStatus> = new Set(['enabled', 'pinned'])

function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

function hasOwnDefined<T extends object>(object: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined
}

function isVisibleStatus(status: MiniAppStatus): boolean {
  return visibleStatuses.has(status)
}

/** Convert a DB row to the public MiniApp DTO. */
function rowToMiniApp(row: MiniAppRow): MiniApp {
  const clean = nullsToUndefined(row)
  const presetMiniAppId = clean.presetMiniAppId ?? null
  const app: MiniApp = {
    appId: brandId(clean.appId),
    presetMiniAppId,
    name: clean.name,
    url: clean.url,
    logo: clean.logo,
    status: clean.status,
    orderKey: clean.orderKey,
    createdAt: timestampToISO(clean.createdAt),
    updatedAt: timestampToISO(clean.updatedAt)
  }

  if (presetMiniAppId !== null) {
    app.bordered = clean.bordered
    app.background = clean.background
    app.supportedRegions = clean.supportedRegions as ('CN' | 'Global')[] | undefined
    app.configuration = clean.configuration
    app.nameKey = clean.nameKey
  }

  return app
}

export class MiniAppService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /** Get a miniapp by appId. Throws NOT_FOUND if absent. */
  async getByAppId(appId: string): Promise<MiniApp> {
    const [row] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    return rowToMiniApp(row)
  }

  /**
   * List miniApps with optional filters.
   * Sort: status priority (pinned > enabled > disabled), then orderKey ASC.
   */
  async list(query: { status?: MiniAppStatus } = {}): Promise<MiniApp[]> {
    const where = query.status !== undefined ? eq(miniAppTable.status, query.status) : undefined
    const rows = await this.db.select().from(miniAppTable).where(where).orderBy(asc(miniAppTable.orderKey))

    const items = rows.map(rowToMiniApp)
    items.sort((a, b) => {
      const order = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const diff = order(a.status) - order(b.status)
      if (diff !== 0) return diff
      return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
    })
    return items
  }

  /**
   * Create a custom miniapp. Rejects collisions with preset ids.
   * Auto-assigns orderKey at the end of the status='enabled' partition.
   */
  async create(dto: CreateMiniAppDto): Promise<MiniApp> {
    if (presetMiniAppIdSet.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a preset app and cannot be recreated`)
    }

    const status: MiniAppStatus = 'enabled'
    const row = await withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx(async (tx) => {
          const inserted = await insertWithOrderKey(
            tx,
            miniAppTable,
            {
              appId: dto.appId,
              presetMiniAppId: null,
              name: dto.name,
              url: dto.url,
              logo: dto.logo,
              status
            },
            {
              pkColumn: miniAppTable.appId,
              position: 'last',
              scope: eq(miniAppTable.status, status)
            }
          )
          return inserted as MiniAppRow | undefined
        }),
      defaultHandlersFor('MiniApp', dto.appId)
    )
    if (!row) {
      throw DataApiErrorFactory.internal(new Error('Insert returned no rows'), 'MiniApp.create')
    }
    logger.info('Created custom miniapp', { appId: row.appId, orderKey: row.orderKey })
    return rowToMiniApp(row)
  }

  /**
   * Update an existing miniapp. Preset rows only accept `status` changes because
   * their display fields are refreshed by {@link MiniAppSeeder}. Custom rows can
   * also edit the user-facing fields exposed by the custom miniapp form.
   *
   * On status transitions the row receives a target-partition `orderKey`.
   * Moving between `enabled` and `pinned` keeps the app near its current key
   * because both statuses share the visible MiniApp list. Moving into or out of
   * `disabled` lands at the tail of the target partition.
   */
  async update(appId: string, dto: UpdateMiniAppDto): Promise<MiniApp> {
    const hasStatusUpdate = dto.status !== undefined
    const hasCustomUpdate = customMutableFields.some((field) => hasOwnDefined(dto, field))

    if (!hasStatusUpdate && !hasCustomUpdate) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for "${appId}"`] },
        'No applicable fields to update'
      )
    }

    const row = await withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx(async (tx) => {
          const [existing] = await tx
            .select({
              presetMiniAppId: miniAppTable.presetMiniAppId,
              status: miniAppTable.status,
              orderKey: miniAppTable.orderKey
            })
            .from(miniAppTable)
            .where(eq(miniAppTable.appId, appId))
            .limit(1)
          if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

          if (hasCustomUpdate && existing.presetMiniAppId !== null) {
            throw DataApiErrorFactory.invalidOperation(
              `update miniapp ${appId}`,
              'preset-derived miniapp user-facing fields cannot be edited'
            )
          }

          const updates: Partial<InsertMiniAppRow> = {}

          if (dto.name !== undefined) updates.name = dto.name
          if (dto.url !== undefined) updates.url = dto.url
          if (dto.logo !== undefined) updates.logo = dto.logo

          if (hasStatusUpdate) {
            const targetStatus = dto.status as MiniAppStatus
            updates.status = targetStatus
            if (existing.status !== targetStatus) {
              if (isVisibleStatus(existing.status) && isVisibleStatus(targetStatus)) {
                const targetScope = and(eq(miniAppTable.status, targetStatus), ne(miniAppTable.appId, appId))
                const [before] = await tx
                  .select({ orderKey: miniAppTable.orderKey })
                  .from(miniAppTable)
                  .where(and(targetScope, lt(miniAppTable.orderKey, existing.orderKey)))
                  .orderBy(desc(miniAppTable.orderKey))
                  .limit(1)
                const [same] = await tx
                  .select({ orderKey: miniAppTable.orderKey })
                  .from(miniAppTable)
                  .where(and(targetScope, eq(miniAppTable.orderKey, existing.orderKey)))
                  .limit(1)
                const [after] = await tx
                  .select({ orderKey: miniAppTable.orderKey })
                  .from(miniAppTable)
                  .where(and(targetScope, gt(miniAppTable.orderKey, existing.orderKey)))
                  .orderBy(asc(miniAppTable.orderKey))
                  .limit(1)

                if (same) {
                  updates.orderKey =
                    existing.status === 'enabled'
                      ? generateOrderKeyBetween(before?.orderKey ?? null, same.orderKey)
                      : generateOrderKeyBetween(same.orderKey, after?.orderKey ?? null)
                } else if (before || after) {
                  updates.orderKey = generateOrderKeyBetween(before?.orderKey ?? null, after?.orderKey ?? null)
                } else {
                  updates.orderKey = existing.orderKey
                }
              } else {
                const [tail] = await tx
                  .select({ orderKey: miniAppTable.orderKey })
                  .from(miniAppTable)
                  .where(and(eq(miniAppTable.status, targetStatus), ne(miniAppTable.appId, appId)))
                  .orderBy(desc(miniAppTable.orderKey))
                  .limit(1)
                updates.orderKey = generateOrderKeyBetween(tail?.orderKey ?? null, null)
              }
            }
          }

          const [updated] = await tx.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning()
          return updated
        }),
      defaultHandlersFor('MiniApp', appId)
    )
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    logger.info('Updated miniapp', { appId, changes: Object.keys(dto) })
    return rowToMiniApp(row)
  }

  /**
   * Delete a miniapp. Preset-derived rows cannot be deleted (use status='disabled').
   * Mirrors {@link ProviderService.delete}'s preset guard.
   */
  async delete(appId: string): Promise<void> {
    const [existing] = await this.db
      .select({ presetMiniAppId: miniAppTable.presetMiniAppId })
      .from(miniAppTable)
      .where(eq(miniAppTable.appId, appId))
      .limit(1)
    if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

    if (existing.presetMiniAppId !== null) {
      throw DataApiErrorFactory.invalidOperation(
        `delete miniapp ${appId}`,
        'preset-derived miniapp cannot be deleted; use PATCH with status="disabled" to hide'
      )
    }

    await withSqliteErrors(
      () => this.db.delete(miniAppTable).where(eq(miniAppTable.appId, appId)),
      defaultHandlersFor('MiniApp', appId)
    )
    logger.info('Deleted miniapp', { appId })
  }

  /**
   * Reorder miniApps via fractional-indexing. The `mini_app.status` column is
   * the reorder scope: a single batch must stay inside one status partition
   * (`enabled` | `disabled` | `pinned`). Cross-partition batches are rejected
   * with `VALIDATION_ERROR` per the DataApi scoped-reorder contract — moving
   * a row between partitions goes through PATCH, not POST /order:batch.
   */
  async reorder(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) =>
          applyScopedMoves(tx, miniAppTable, moves, {
            pkColumn: miniAppTable.appId,
            scopeColumn: miniAppTable.status
          })
        ),
      defaultHandlersFor('MiniApp', 'multiple')
    )
    logger.info('Reordered miniApps', { count: moves.length })
  }
}

export const miniAppService = new MiniAppService()
