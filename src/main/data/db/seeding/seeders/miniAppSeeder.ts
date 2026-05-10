import { type MiniAppInsert, miniAppTable } from '@data/db/schemas/miniApp'
import { generateOrderKeySequenceBetween } from '@data/services/utils/orderKey'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { eq, isNotNull, max } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Seed preset mini-app rows from {@link PRESETS_MINI_APPS}.
 *
 * Re-runs whenever the preset data changes (auto-detected via {@link hashObject}).
 * On re-run, refreshes preset display fields unconditionally — no UI lets users
 * edit them, so there is no per-user state to preserve. `status` and `orderKey`
 * are kept on existing rows; only newly-seeded rows receive orderKey.
 *
 * OrderKey allocation: new presets are appended after existing rows in the same
 * status partition to avoid collisions with migrator-written rows (v1→v2 upgrade).
 */
export class MiniAppSeeder implements ISeeder {
  readonly name = 'miniApp'
  readonly description = 'Insert/refresh preset mini-app rows from PRESETS_MINI_APPS'
  readonly version: string

  constructor() {
    this.version = hashObject(PRESETS_MINI_APPS)
  }

  async run(db: DbType): Promise<void> {
    const existingIds = await db
      .select({ appId: miniAppTable.appId })
      .from(miniAppTable)
      .where(isNotNull(miniAppTable.presetMiniAppId))
      .then((rows) => new Set(rows.map((r) => r.appId)))

    const newPresets = PRESETS_MINI_APPS.filter((p) => !existingIds.has(p.id))
    const orderKeys = await this.generateOrderKeysForNewPresets(db, newPresets.length)
    for (let i = 0; i < PRESETS_MINI_APPS.length; i++) {
      const preset = PRESETS_MINI_APPS[i]
      const isNew = !existingIds.has(preset.id)
      const orderKey = isNew ? orderKeys.shift()! : ''

      const insertRow: MiniAppInsert = {
        appId: preset.id,
        presetMiniAppId: preset.id,
        name: preset.name,
        url: preset.url,
        logo: preset.logo ?? null,
        bordered: preset.bordered ?? true,
        background: preset.background ?? null,
        supportedRegions: preset.supportedRegions ?? null,
        nameKey: preset.nameKey ?? null,
        status: 'enabled',
        orderKey: isNew ? orderKey : ''
      }

      // On conflict: refresh preset display fields, but only for rows that
      // were themselves seeded from a preset (`presetMiniAppId IS NOT NULL`).
      // A custom row whose appId happens to collide with a preset id (e.g. a
      // migrated v1 custom app) keeps its own name/url/logo. status, orderKey,
      // and presetMiniAppId stay untouched on every existing row.
      await db
        .insert(miniAppTable)
        .values(insertRow)
        .onConflictDoUpdate({
          target: miniAppTable.appId,
          set: {
            name: insertRow.name,
            url: insertRow.url,
            logo: insertRow.logo,
            bordered: insertRow.bordered,
            background: insertRow.background,
            supportedRegions: insertRow.supportedRegions,
            nameKey: insertRow.nameKey
          },
          setWhere: isNotNull(miniAppTable.presetMiniAppId)
        })
    }
  }

  /**
   * Generate order keys for new presets, placing them after existing rows
   * in the 'enabled' status partition.
   */
  private async generateOrderKeysForNewPresets(db: DbType, count: number): Promise<string[]> {
    if (count === 0) return []
    const result = await db
      .select({ maxOrderKey: max(miniAppTable.orderKey) })
      .from(miniAppTable)
      .where(eq(miniAppTable.status, 'enabled'))

    const maxExistingKey = result[0]?.maxOrderKey ?? null
    return generateOrderKeySequenceBetween(maxExistingKey, null, count)
  }
}
