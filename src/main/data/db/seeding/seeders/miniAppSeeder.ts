import { type InsertMiniAppRow, miniAppTable } from '@data/db/schemas/miniApp'
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm'

import type { DbOrTx, DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Seed preset miniapp rows from {@link PRESETS_MINI_APPS}.
 *
 * Re-runs whenever the preset data changes (auto-detected via {@link hashObject}).
 * On re-run, refreshes preset display fields unconditionally — no UI lets users
 * edit them, so there is no per-user state to preserve. `status` and `orderKey`
 * are kept on existing rows; only newly-seeded rows receive defaults.
 */
export class MiniAppSeeder implements ISeeder {
  readonly name = 'miniApp'
  readonly description = 'Insert/refresh preset miniapp rows from PRESETS_MINI_APPS'
  readonly version: string

  private readonly firstPresetMiniAppId = 'radeon-cloud'

  /** Pre-generated fractional-indexing keys, one per preset in declared order. */
  private readonly presetDefaultOrderKeys: ReadonlyMap<string, string>

  constructor() {
    this.version = hashObject(PRESETS_MINI_APPS)
    const keys = generateOrderKeySequence(PRESETS_MINI_APPS.length)
    this.presetDefaultOrderKeys = new Map(PRESETS_MINI_APPS.map((p, i) => [p.id, keys[i]]))
  }

  run(db: DbType): void {
    for (const preset of PRESETS_MINI_APPS) {
      const isFirstPresetMissing = this.isFirstPresetMissing(db, preset.id)
      const insertRow: InsertMiniAppRow = {
        appId: preset.id,
        presetMiniAppId: preset.id,
        name: preset.name,
        url: preset.url,
        logoKey: preset.logo ?? null,
        bordered: preset.bordered ?? true,
        background: preset.background ?? null,
        supportedRegions: preset.supportedRegions ?? null,
        nameKey: preset.nameKey ?? null,
        status: 'enabled',
        orderKey: isFirstPresetMissing
          ? this.generateFirstVisibleOrderKey(db)
          : (this.presetDefaultOrderKeys.get(preset.id) ?? '')
      }

      // On conflict: refresh preset display fields, but only for rows that
      // were themselves seeded from a preset (`presetMiniAppId IS NOT NULL`).
      // A custom row whose appId happens to collide with a preset id (e.g. a
      // migrated v1 custom app) keeps its own name/url/logo. status, orderKey,
      // and presetMiniAppId stay untouched on every existing row.
      db.insert(miniAppTable)
        .values(insertRow)
        .onConflictDoUpdate({
          target: miniAppTable.appId,
          set: {
            name: insertRow.name,
            url: insertRow.url,
            logoKey: insertRow.logoKey,
            bordered: insertRow.bordered,
            background: insertRow.background,
            supportedRegions: insertRow.supportedRegions,
            nameKey: insertRow.nameKey
          },
          setWhere: isNotNull(miniAppTable.presetMiniAppId)
        })
        .run()
    }

    this.applyFirstPresetOrder(db)
  }

  private isFirstPresetMissing(db: DbOrTx, presetId: string): boolean {
    if (presetId !== this.firstPresetMiniAppId) return false

    const rows = db
      .select({ appId: miniAppTable.appId })
      .from(miniAppTable)
      .where(eq(miniAppTable.appId, presetId))
      .limit(1)
      .all()
    return rows.length === 0
  }

  private generateFirstVisibleOrderKey(db: DbOrTx): string {
    const [firstVisibleRow] = db
      .select({ orderKey: miniAppTable.orderKey })
      .from(miniAppTable)
      .where(inArray(miniAppTable.status, ['enabled', 'pinned']))
      .orderBy(asc(miniAppTable.orderKey))
      .limit(1)
      .all()

    return generateOrderKeyBetween(null, firstVisibleRow?.orderKey ?? null)
  }

  private applyFirstPresetOrder(db: DbOrTx): void {
    const [firstPresetRow] = db
      .select({ orderKey: miniAppTable.orderKey, presetMiniAppId: miniAppTable.presetMiniAppId, status: miniAppTable.status })
      .from(miniAppTable)
      .where(eq(miniAppTable.appId, this.firstPresetMiniAppId))
      .limit(1)
      .all()

    if (!firstPresetRow?.presetMiniAppId || !['enabled', 'pinned'].includes(firstPresetRow.status)) return

    const [firstVisibleRow] = db
      .select({ orderKey: miniAppTable.orderKey })
      .from(miniAppTable)
      .where(and(inArray(miniAppTable.status, ['enabled', 'pinned']), ne(miniAppTable.appId, this.firstPresetMiniAppId)))
      .orderBy(asc(miniAppTable.orderKey))
      .limit(1)
      .all()

    if (!firstVisibleRow || firstPresetRow.orderKey < firstVisibleRow.orderKey) return

    db
      .update(miniAppTable)
      .set({ orderKey: generateOrderKeyBetween(null, firstVisibleRow.orderKey) })
      .where(eq(miniAppTable.appId, this.firstPresetMiniAppId))
      .run()
  }
}
