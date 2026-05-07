/**
 * MiniApp Service - handles miniapp CRUD operations.
 *
 * Owns the `mini_app` SQLite table. Mirrors {@link ProviderService}:
 * uniform CRUD over rows, with row-shape policy enforced via column checks
 * (`presetMiniappId`). Preset display fields are seeded by {@link MiniAppSeeder}
 * at boot and refreshed on every re-run (no UI exposes them for editing).
 *
 * Layered preset pattern:
 *   - presetMiniappId !== null  →  inherits from a {@link PRESETS_MINI_APPS} entry
 *   - presetMiniappId === null  →  pure custom app
 */

import { application } from '@application'
import {
  type MiniAppInsert,
  type MiniAppRegion,
  type MiniAppSelect,
  type MiniAppStatus,
  miniAppTable
} from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { and, asc, desc, eq, ne } from 'drizzle-orm'

import { applyScopedMoves, generateOrderKeyBetween, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

/** Preset id set, used for write-time collision rejection. */
const presetMiniappIdSet: ReadonlySet<string> = new Set(PRESETS_MINI_APPS.map((p) => p.id))

function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

/** Convert a DB row to the public MiniApp DTO. */
function rowToMiniApp(row: MiniAppSelect): MiniApp {
  const clean = nullsToUndefined(row)
  return {
    appId: brandId(clean.appId),
    presetMiniappId: clean.presetMiniappId ?? null,
    name: clean.name,
    url: clean.url,
    logo: clean.logo,
    bordered: clean.bordered,
    background: clean.background,
    supportedRegions: clean.supportedRegions as ('CN' | 'Global')[] | undefined,
    configuration: clean.configuration,
    nameKey: clean.nameKey,
    status: clean.status,
    orderKey: clean.orderKey,
    createdAt: timestampToISO(clean.createdAt),
    updatedAt: timestampToISO(clean.updatedAt)
  }
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
   * List miniapps with optional filters.
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
    if (presetMiniappIdSet.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a preset app and cannot be recreated`)
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
              presetMiniappId: null,
              name: dto.name,
              url: dto.url,
              logo: dto.logo,
              status,
              bordered: dto.bordered,
              background: dto.background ?? null,
              supportedRegions: dto.supportedRegions as MiniAppRegion[] | undefined,
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
    logger.info('Created custom miniapp', { appId: row.appId, orderKey: row.orderKey })
    return rowToMiniApp(row)
  }

  /**
   * Update an existing miniapp. Currently only `status` is mutable — preset
   * display fields (name/url/logo/...) are owned by {@link MiniAppSeeder} and
   * have no edit UI; reordering within a partition goes through the dedicated
   * `/order` endpoints.
   *
   * On status transitions the row also receives a fresh `orderKey` placed at
   * the tail of the target partition. `orderKey` is scoped to `status`, so
   * letting a row carry its old key into a new partition risks duplicates and
   * leaves ordering unstable across enabled / disabled / pinned.
   */
  async update(appId: string, dto: UpdateMiniAppDto): Promise<MiniApp> {
    if (dto.status === undefined) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for "${appId}"`] },
        'No applicable fields to update'
      )
    }

    const targetStatus = dto.status

    const row = await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ status: miniAppTable.status })
            .from(miniAppTable)
            .where(eq(miniAppTable.appId, appId))
            .limit(1)
          if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

          const updates: Partial<MiniAppInsert> = { status: targetStatus }

          if (existing.status !== targetStatus) {
            // Transitioning partitions: place at tail of the target partition.
            const [tail] = await tx
              .select({ orderKey: miniAppTable.orderKey })
              .from(miniAppTable)
              .where(and(eq(miniAppTable.status, targetStatus), ne(miniAppTable.appId, appId)))
              .orderBy(desc(miniAppTable.orderKey))
              .limit(1)
            updates.orderKey = generateOrderKeyBetween(tail?.orderKey ?? null, null)
          }

          const [updated] = await tx.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning()
          return updated
        }),
      defaultHandlersFor('MiniApp', appId)
    )
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    logger.info('Updated miniapp', { appId, status: targetStatus })
    return rowToMiniApp(row)
  }

  /**
   * Delete a miniapp. Preset-derived rows cannot be deleted (use status='disabled').
   * Mirrors {@link ProviderService.delete}'s preset guard.
   */
  async delete(appId: string): Promise<void> {
    const [existing] = await this.db
      .select({ presetMiniappId: miniAppTable.presetMiniappId })
      .from(miniAppTable)
      .where(eq(miniAppTable.appId, appId))
      .limit(1)
    if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

    if (existing.presetMiniappId !== null) {
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
   * Reorder miniapps via fractional-indexing. The `mini_app.status` column is
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
    logger.info('Reordered miniapps', { count: moves.length })
  }
}

export const miniAppService = new MiniAppService()
