/**
 * MiniApp Entity Service — owns the `mini_app` SQLite table.
 *
 * This service performs uniform CRUD over rows. It does **not** know about
 * preset semantics — the discriminator (`presetMiniappId`) is just another
 * column. Policy decisions (e.g. preset apps are delta-only, only `status`
 * is mutable on a preset row) live in {@link MiniAppRegistryService}.
 *
 * Pattern mirrors {@link ProviderService}: rows are persisted as given;
 * Registry Service composes the right shape before calling.
 */

import { application } from '@application'
import { type MiniAppInsert, type MiniAppSelect, type MiniAppStatus, miniAppTable } from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:MiniAppService')

export interface ListMiniAppRowsFilter {
  status?: MiniAppStatus
  /** `true` → only rows linked to a preset; `false` → only pure-custom rows. Omit for all. */
  hasPreset?: boolean
}

export class MiniAppService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async getByAppId(appId: string): Promise<MiniAppSelect> {
    const [row] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    return row
  }

  async findByAppId(appId: string): Promise<MiniAppSelect | undefined> {
    const [row] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)
    return row
  }

  async list(filter: ListMiniAppRowsFilter = {}): Promise<MiniAppSelect[]> {
    const conditions: SQL[] = []
    if (filter.status !== undefined) {
      conditions.push(eq(miniAppTable.status, filter.status))
    }
    if (filter.hasPreset === true) {
      conditions.push(isNotNull(miniAppTable.presetMiniappId))
    } else if (filter.hasPreset === false) {
      conditions.push(isNull(miniAppTable.presetMiniappId))
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined
    return await this.db.select().from(miniAppTable).where(where).orderBy(asc(miniAppTable.orderKey))
  }

  /**
   * INSERT a row, auto-assigning `orderKey` at the end of its status partition
   * via `insertWithOrderKey`. Caller supplies all fields except `orderKey`.
   */
  async create(input: Omit<MiniAppInsert, 'orderKey'>): Promise<MiniAppSelect> {
    const status = input.status ?? 'enabled'
    const row = await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          const inserted = await insertWithOrderKey(tx, miniAppTable, input, {
            pkColumn: miniAppTable.appId,
            position: 'last',
            scope: eq(miniAppTable.status, status)
          })
          return inserted as MiniAppSelect | undefined
        }),
      defaultHandlersFor('MiniApp', input.appId)
    )

    if (!row) {
      throw DataApiErrorFactory.internal(new Error('Insert returned no rows'), 'MiniApp.create')
    }
    logger.info('Created miniapp', { appId: row.appId, presetMiniappId: row.presetMiniappId, orderKey: row.orderKey })
    return row
  }

  /**
   * INSERT-or-UPDATE a row. Caller provides the full insert shape including
   * `orderKey`. On update, only fields present in `input` (other than `appId`)
   * are written. Used by Registry Service for seeding preset override rows.
   */
  async upsert(input: MiniAppInsert): Promise<MiniAppSelect> {
    const existing = await this.findByAppId(input.appId)

    return await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          if (existing) {
            const { appId: _appId, ...updates } = input
            const [row] = await tx
              .update(miniAppTable)
              .set(updates)
              .where(eq(miniAppTable.appId, input.appId))
              .returning()
            return row as MiniAppSelect
          }

          const [row] = await tx.insert(miniAppTable).values(input).returning()
          return row as MiniAppSelect
        }),
      defaultHandlersFor('MiniApp', input.appId)
    )
  }

  /** UPDATE an existing row. Throws NOT_FOUND if absent or VALIDATION_ERROR if no fields. */
  async update(appId: string, updates: Partial<MiniAppInsert>): Promise<MiniAppSelect> {
    if (Object.keys(updates).length === 0) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for "${appId}"`] },
        'No applicable fields to update'
      )
    }
    const [row] = await withSqliteErrors(
      () => this.db.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning(),
      defaultHandlersFor('MiniApp', appId)
    )
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    logger.info('Updated miniapp', { appId, changes: Object.keys(updates) })
    return row
  }

  async delete(appId: string): Promise<void> {
    const result = await withSqliteErrors(
      () => this.db.delete(miniAppTable).where(eq(miniAppTable.appId, appId)).returning({ appId: miniAppTable.appId }),
      defaultHandlersFor('MiniApp', appId)
    )
    if (result.length === 0) {
      throw DataApiErrorFactory.notFound('MiniApp', appId)
    }
    logger.info('Deleted miniapp', { appId })
  }

  /** Apply fractional-indexing moves within a single status partition. */
  async applyMovesScoped(
    moves: Array<{ id: string; anchor: OrderRequest }>,
    scopeStatus: MiniAppStatus
  ): Promise<void> {
    if (moves.length === 0) return
    await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          await applyMoves(tx, miniAppTable, moves, {
            pkColumn: miniAppTable.appId,
            scope: eq(miniAppTable.status, scopeStatus)
          })
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )
    logger.info('Reordered miniapps', { count: moves.length, scope: scopeStatus })
  }

  async getStatusesByAppIds(appIds: string[]): Promise<Map<string, MiniAppStatus>> {
    if (appIds.length === 0) return new Map()
    const rows = await this.db
      .select({ appId: miniAppTable.appId, status: miniAppTable.status })
      .from(miniAppTable)
      .where(inArray(miniAppTable.appId, appIds))
    return new Map(rows.map((r) => [r.appId, r.status]))
  }
}

export const miniAppService = new MiniAppService()
