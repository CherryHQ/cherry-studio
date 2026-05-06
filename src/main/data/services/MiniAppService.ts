/**
 * MiniApp Service - handles miniapp CRUD operations.
 *
 * Owns the `mini_app` SQLite table. Mirrors {@link ProviderService}:
 * uniform CRUD over rows, with row-shape policy enforced via column checks
 * (`presetMiniappId`). Preset rows are seeded by {@link MiniAppSeeder} at
 * boot; user-modified fields tracked in `userOverrides` are preserved across
 * preset version bumps (see best-practice-layered-preset-pattern.md
 * §"Update Compatibility").
 *
 * Layered preset pattern:
 *   - presetMiniappId !== null  →  inherits from a {@link PRESETS_MINI_APPS} entry
 *   - presetMiniappId === null  →  pure custom app
 */

import { application } from '@application'
import {
  isRegistryEnrichableField,
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
import { asc, eq, inArray } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

/** Preset id set, used for write-time collision rejection. */
const presetMiniappIdSet: ReadonlySet<string> = new Set(PRESETS_MINI_APPS.map((p) => p.id))

function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

/**
 * Mapping from UpdateMiniAppDto field → DB column.
 * Mirrors {@link UPDATE_MODEL_FIELD_MAP}. Plain string entries map identically.
 */
const UPDATE_MINI_APP_FIELDS: ReadonlyArray<keyof UpdateMiniAppDto> = [
  'name',
  'url',
  'logo',
  'status',
  'bordered',
  'background',
  'supportedRegions',
  'configuration'
]

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
   * Update an existing miniapp. Tracks user-modified fields in `userOverrides`
   * so {@link MiniAppSeeder} can preserve them on preset re-sync.
   * Mirrors {@link ModelService.update}'s userOverrides tracking.
   */
  async update(appId: string, dto: UpdateMiniAppDto): Promise<MiniApp> {
    const [existing] = await this.db.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1)
    if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

    const updates: Partial<MiniAppInsert> = {}
    for (const field of UPDATE_MINI_APP_FIELDS) {
      if (dto[field] !== undefined) {
        ;(updates as Record<string, unknown>)[field] = dto[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for "${appId}"`] },
        'No applicable fields to update'
      )
    }

    // Track which registry-enrichable fields the user explicitly changed.
    if (existing.presetMiniappId !== null) {
      const changedEnrichableFields = Object.keys(dto).filter(isRegistryEnrichableField)
      if (changedEnrichableFields.length > 0) {
        const existingOverrides = existing.userOverrides ?? []
        updates.userOverrides = [...new Set([...existingOverrides, ...changedEnrichableFields])]
      }
    }

    const [row] = await withSqliteErrors(
      () => this.db.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning(),
      defaultHandlersFor('MiniApp', appId)
    )
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    logger.info('Updated miniapp', { appId, changes: Object.keys(updates) })
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
   * Reorder miniapps via fractional-indexing. Resolves each move's status
   * partition and applies moves per partition. Cross-partition batches are
   * split into one applyMoves call per status.
   */
  async reorder(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    const targetIds = moves.map((m) => m.id)
    const rows = await this.db
      .select({ appId: miniAppTable.appId, status: miniAppTable.status })
      .from(miniAppTable)
      .where(inArray(miniAppTable.appId, targetIds))
    const statusByAppId = new Map(rows.map((r) => [r.appId, r.status]))

    const movesByStatus = new Map<MiniAppStatus, Array<{ id: string; anchor: OrderRequest }>>()
    for (const m of moves) {
      const status = statusByAppId.get(m.id)
      if (!status) throw DataApiErrorFactory.notFound('MiniApp', m.id)
      const bucket = movesByStatus.get(status) ?? []
      bucket.push(m)
      movesByStatus.set(status, bucket)
    }

    await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          for (const [status, scopedMoves] of movesByStatus) {
            await applyMoves(tx, miniAppTable, scopedMoves, {
              pkColumn: miniAppTable.appId,
              scope: eq(miniAppTable.status, status)
            })
          }
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )
    logger.info('Reordered miniapps', { count: moves.length, partitions: movesByStatus.size })
  }
}

export const miniAppService = new MiniAppService()
