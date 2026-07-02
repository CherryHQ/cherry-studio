/**
 * MiniApp table schema
 *
 * Stores user's miniapp configurations and preferences
 * Supports both system default apps and user-customized apps
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex } from './_columnHelpers'
import { fileEntryTable } from './file'

export type MiniAppStatus = 'enabled' | 'disabled' | 'pinned'

export type MiniAppRegion = 'CN' | 'Global'

/**
 * MiniApp table — single table holds preset-derived and custom miniApps,
 * following the same pattern as `user_provider` / `user_model`:
 *
 *   - `presetMiniAppId` links a row to its preset entry (NULL for custom apps).
 *   - Preset display fields (name/url/logo/...) are refreshed unconditionally
 *     by {@link MiniAppSeeder} on every boot since no UI lets users edit them.
 */
export const miniAppTable = sqliteTable(
  'mini_app',
  {
    appId: text('app_id').primaryKey(),

    /** Preset id this row inherits from. NULL for custom apps. Mirrors `userProviderTable.presetProviderId`. */
    presetMiniAppId: text('preset_mini_app_id'),

    name: text().notNull(),
    url: text().notNull(),

    /**
     * Preset/bundled logo reference — a `getMiniAppsLogo` icon id (e.g.
     * `'application'`). Holds an icon key / ref only — never a remote URL or
     * data URL. User-uploaded custom logos are stored on disk and referenced
     * via {@link logoFileId} instead.
     */
    logoKey: text('logo_key'),

    /**
     * Custom user-uploaded logo: FK to the on-disk `file_entry` holding a
     * normalized 128×128 WebP. NULL when the app has no uploaded logo (falls
     * back to {@link logoKey} / the bundled icon). `set null` on delete so pruning
     * the file entry clears the reference automatically.
     */
    logoFileId: text('logo_file_id').references(() => fileEntryTable.id, { onDelete: 'set null' }),

    status: text().$type<MiniAppStatus>().notNull().default('enabled'),

    // Fractional-indexing order key. Enabled + pinned share visible scope; disabled is separate.
    ...orderKeyColumns,

    bordered: integer({ mode: 'boolean' }).notNull().default(true),
    background: text(),
    supportedRegions: text('supported_regions', { mode: 'json' }).$type<MiniAppRegion[]>(),
    configuration: text({ mode: 'json' }),
    nameKey: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    scopedOrderKeyIndex('mini_app', 'status')(t),
    index('mini_app_preset_mini_app_id_idx').on(t.presetMiniAppId),
    check('mini_app_status_check', sql`${t.status} IN ('enabled', 'disabled', 'pinned')`)
  ]
)

export type MiniAppRow = typeof miniAppTable.$inferSelect
export type InsertMiniAppRow = typeof miniAppTable.$inferInsert
