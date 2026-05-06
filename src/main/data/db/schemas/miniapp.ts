/**
 * MiniApp table schema
 *
 * Stores user's miniapp configurations and preferences
 * Supports both system default apps and user-customized apps
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex } from './_columnHelpers'

export type MiniAppStatus = 'enabled' | 'disabled' | 'pinned'

export type MiniAppRegion = 'CN' | 'Global'

/**
 * Fields whose values can be re-synced from {@link PRESETS_MINI_APPS} during
 * a batch upsert. If the user has explicitly modified a field (tracked in
 * `userOverrides`), the sync skips that field. Same mechanism as
 * {@link userModelTable.userOverrides}.
 */
export const REGISTRY_ENRICHABLE_MINIAPP_FIELDS = [
  'name',
  'url',
  'logo',
  'bordered',
  'background',
  'supportedRegions',
  'nameKey'
] as const
export type RegistryEnrichableMiniAppField = (typeof REGISTRY_ENRICHABLE_MINIAPP_FIELDS)[number]

export function isRegistryEnrichableField(field: string): field is RegistryEnrichableMiniAppField {
  return (REGISTRY_ENRICHABLE_MINIAPP_FIELDS as readonly string[]).includes(field)
}

/**
 * MiniApp table — single table holds preset-derived and custom miniapps,
 * following the same pattern as `user_provider` / `user_model`:
 *
 *   - `presetMiniappId` links a row to its preset entry (NULL for custom apps).
 *   - `userOverrides` lists fields the user has explicitly modified;
 *     {@link MiniAppSeeder} skips these fields when re-syncing
 *     preset data so user edits survive preset version bumps. See
 *     best-practice-layered-preset-pattern.md §"Update Compatibility".
 */
export const miniAppTable = sqliteTable(
  'mini_app',
  {
    appId: text('app_id').primaryKey(),

    /** Preset id this row inherits from. NULL for custom apps. Mirrors `userProviderTable.presetProviderId`. */
    presetMiniappId: text('preset_miniapp_id'),

    name: text().notNull(),
    url: text().notNull(),
    logo: text(),

    status: text().$type<MiniAppStatus>().notNull().default('enabled'),

    // Fractional-indexing order key, scoped per status (see data-ordering-guide.md)
    ...orderKeyColumns,

    bordered: integer({ mode: 'boolean' }).default(true),
    background: text(),
    supportedRegions: text('supported_regions', { mode: 'json' }).$type<MiniAppRegion[]>(),
    configuration: text({ mode: 'json' }),
    nameKey: text(),

    /** Fields user has explicitly modified. {@link MiniAppSeeder} skips these on preset re-sync. */
    userOverrides: text('user_overrides', { mode: 'json' }).$type<RegistryEnrichableMiniAppField[]>(),

    ...createUpdateTimestamps
  },
  (t) => [
    scopedOrderKeyIndex('mini_app', 'status')(t),
    index('mini_app_preset_miniapp_id_idx').on(t.presetMiniappId),
    check('mini_app_status_check', sql`${t.status} IN ('enabled', 'disabled', 'pinned')`)
  ]
)

export type MiniAppSelect = typeof miniAppTable.$inferSelect
export type MiniAppInsert = typeof miniAppTable.$inferInsert
