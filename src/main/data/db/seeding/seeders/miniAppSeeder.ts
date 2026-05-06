import {
  isRegistryEnrichableField,
  type MiniAppInsert,
  miniAppTable,
  type RegistryEnrichableMiniAppField
} from '@data/db/schemas/miniapp'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

/**
 * Seed preset miniapp rows from {@link PRESETS_MINI_APPS}.
 *
 * Re-runs whenever the preset data changes (auto-detected via {@link hashObject}).
 * On re-run, refreshes registry-enrichable fields **except** those listed in
 * each row's `userOverrides` — same mechanism as ModelService.batchUpsert.
 * User edits survive preset version bumps (see
 * docs/references/data/best-practice-layered-preset-pattern.md
 * §"Update Compatibility").
 *
 * Status and orderKey are preserved on existing rows; only newly-seeded rows
 * receive defaults.
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
    // Fetch existing preset rows to read their userOverrides.
    const presetIds = PRESETS_MINI_APPS.map((p) => p.id)
    const existingRows = await db
      .select({
        appId: miniAppTable.appId,
        userOverrides: miniAppTable.userOverrides
      })
      .from(miniAppTable)
      .where(inArray(miniAppTable.appId, presetIds))

    const overridesByAppId = new Map<string, Set<RegistryEnrichableMiniAppField>>()
    for (const row of existingRows) {
      overridesByAppId.set(row.appId, new Set(row.userOverrides ?? []))
    }

    for (const preset of PRESETS_MINI_APPS) {
      const userOverrides = overridesByAppId.get(preset.id) ?? new Set<RegistryEnrichableMiniAppField>()

      const insertRow: MiniAppInsert = {
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
        orderKey: this.presetDefaultOrderKeys.get(preset.id) ?? ''
      }

      // On conflict: refresh registry-enrichable fields not in userOverrides.
      // status, orderKey, presetMiniappId stay untouched on existing rows.
      const refreshSet: Partial<MiniAppInsert> = {}
      const enrichableValues: Record<RegistryEnrichableMiniAppField, unknown> = {
        name: insertRow.name,
        url: insertRow.url,
        logo: insertRow.logo,
        bordered: insertRow.bordered,
        background: insertRow.background,
        supportedRegions: insertRow.supportedRegions,
        nameKey: insertRow.nameKey
      }
      for (const [field, value] of Object.entries(enrichableValues)) {
        if (isRegistryEnrichableField(field) && !userOverrides.has(field)) {
          ;(refreshSet as Record<string, unknown>)[field] = value
        }
      }

      if (Object.keys(refreshSet).length === 0) {
        await db.insert(miniAppTable).values(insertRow).onConflictDoNothing()
      } else {
        await db.insert(miniAppTable).values(insertRow).onConflictDoUpdate({
          target: miniAppTable.appId,
          set: refreshSet
        })
      }
    }
  }
}
