/**
 * MiniApp Service - handles miniapp CRUD operations.
 *
 * Owns the `mini_app` SQLite table. Mirrors {@link ProviderService}:
 * uniform CRUD over rows, with row-shape policy enforced via column checks
 * (`presetMiniappId`). Preset re-sync uses {@link batchUpsertPresets}, which
 * respects `userOverrides` so user edits survive preset version bumps — same
 * mechanism as {@link ModelService.batchUpsert}.
 *
 * Layered preset pattern: see best-practice-layered-preset-pattern.md
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
  miniAppTable,
  type RegistryEnrichableMiniAppField
} from '@data/db/schemas/miniapp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'

import { applyMoves, generateOrderKeySequence, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:MiniAppService')

/** Preset id set, used for write-time collision rejection. */
const presetMiniappIdSet: ReadonlySet<string> = new Set(PRESETS_MINI_APPS.map((p) => p.id))

/**
 * Pre-generated fractional-indexing keys for preset apps in their declared order.
 * Used by {@link batchUpsert} to seed initial orderKey values.
 */
const PRESET_DEFAULT_ORDER_KEYS: ReadonlyArray<string> = generateOrderKeySequence(PRESETS_MINI_APPS.length)
const presetDefaultOrderKey: ReadonlyMap<string, string> = new Map(
  PRESETS_MINI_APPS.map((p, i) => [p.id, PRESET_DEFAULT_ORDER_KEYS[i]])
)

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
    kind: clean.presetMiniappId !== undefined ? 'default' : 'custom',
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
  async list(query: { status?: MiniAppStatus; type?: 'default' | 'custom' } = {}): Promise<MiniApp[]> {
    const conditions: SQL[] = []
    if (query.status !== undefined) {
      conditions.push(eq(miniAppTable.status, query.status))
    }
    if (query.type === 'default') {
      conditions.push(eq(miniAppTable.presetMiniappId, miniAppTable.appId))
    } else if (query.type === 'custom') {
      // Filter pure-custom rows (presetMiniappId IS NULL) — done in JS since drizzle's isNull
      // would require additional import; stick with post-filter for simplicity.
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db.select().from(miniAppTable).where(where).orderBy(asc(miniAppTable.orderKey))

    let items = rows.map(rowToMiniApp)
    if (query.type === 'custom') {
      items = items.filter((m) => m.kind === 'custom')
    }
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
   * so {@link batchUpsert} can preserve them on preset re-sync.
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

  /**
   * Batch upsert preset rows from {@link PRESETS_MINI_APPS}.
   *
   * - Inserts new preset entries that don't exist yet.
   * - For existing rows, refreshes preset-managed fields **except** those listed
   *   in each row's `userOverrides`. This preserves user edits across preset
   *   version bumps — same mechanism as {@link ModelService.batchUpsert}.
   *
   * Called at boot or admin time; not exposed via the API.
   */
  async batchUpsertPresets(): Promise<void> {
    const db = this.db

    // Fetch all existing preset-derived rows to get their userOverrides
    const existingRows = await db
      .select({
        appId: miniAppTable.appId,
        userOverrides: miniAppTable.userOverrides
      })
      .from(miniAppTable)
      .where(
        inArray(
          miniAppTable.appId,
          PRESETS_MINI_APPS.map((p) => p.id)
        )
      )

    const overridesByAppId = new Map<string, Set<RegistryEnrichableMiniAppField>>()
    for (const row of existingRows) {
      if (row.userOverrides && row.userOverrides.length > 0) {
        overridesByAppId.set(row.appId, new Set(row.userOverrides))
      } else {
        overridesByAppId.set(row.appId, new Set())
      }
    }

    await db.transaction(async (tx) => {
      for (const preset of PRESETS_MINI_APPS) {
        const userOverrides = overridesByAppId.get(preset.id) ?? new Set<RegistryEnrichableMiniAppField>()

        // Build the full preset row.
        const presetRow: MiniAppInsert = {
          appId: preset.id,
          presetMiniappId: preset.id,
          name: preset.name,
          url: preset.url,
          logo: preset.logo ?? null,
          bordered: preset.bordered ?? true,
          background: preset.background ?? null,
          supportedRegions: preset.supportedRegions ?? null,
          nameKey: preset.nameKey ?? null,
          status: 'enabled',
          orderKey: presetDefaultOrderKey.get(preset.id) ?? ''
        }

        // For onConflictDoUpdate: refresh only fields not in userOverrides.
        const refreshSet: Partial<MiniAppInsert> = {}
        const enrichableFields: Record<RegistryEnrichableMiniAppField, unknown> = {
          name: preset.name,
          url: preset.url,
          logo: preset.logo ?? null,
          bordered: preset.bordered ?? true,
          background: preset.background ?? null,
          supportedRegions: preset.supportedRegions ?? null,
          nameKey: preset.nameKey ?? null
        }
        for (const [field, value] of Object.entries(enrichableFields)) {
          if (!userOverrides.has(field as RegistryEnrichableMiniAppField)) {
            ;(refreshSet as Record<string, unknown>)[field] = value
          }
        }

        await tx.insert(miniAppTable).values(presetRow).onConflictDoUpdate({
          target: miniAppTable.appId,
          set: refreshSet
        })
      }
    })

    logger.info('Batch upserted preset miniapps', { count: PRESETS_MINI_APPS.length })
  }
}

export const miniAppService = new MiniAppService()
