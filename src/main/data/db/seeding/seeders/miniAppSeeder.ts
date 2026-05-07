import { type MiniAppInsert, miniAppTable } from '@data/db/schemas/miniapp'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { isNotNull } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
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

  /** Pre-generated fractional-indexing keys, one per preset in declared order. */
  private readonly presetDefaultOrderKeys: ReadonlyMap<string, string>

  constructor() {
    this.version = hashObject(PRESETS_MINI_APPS)
    const keys = generateOrderKeySequence(PRESETS_MINI_APPS.length)
    this.presetDefaultOrderKeys = new Map(PRESETS_MINI_APPS.map((p, i) => [p.id, keys[i]]))
  }

  async run(db: DbType): Promise<void> {
    for (const preset of PRESETS_MINI_APPS) {
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
        orderKey: this.presetDefaultOrderKeys.get(preset.id) ?? ''
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
}
