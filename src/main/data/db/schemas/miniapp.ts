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

/**
 * Logical kind, derived at runtime from `presetMiniappId`:
 *   presetMiniappId !== null ⇒ 'default'  (inherits from a PRESETS_MINI_APPS entry)
 *   presetMiniappId === null ⇒ 'custom'   (user-created)
 *
 * Not stored as a column. Same pattern as {@link UserProvider.presetProviderId}.
 */
export type MiniAppKind = 'default' | 'custom'

export type MiniAppRegion = 'CN' | 'Global'

/**
 * MiniApp table — stores either:
 *
 *   - A **delta-only override row** for a preset app (preset_miniapp_id=appId,
 *     name/url/logo/etc. NULL). Preset fields come from PRESETS_MINI_APPS at
 *     read time, so future preset updates propagate automatically. Override
 *     rows are written lazily — only when the user modifies status, orderKey,
 *     etc. Uncustomized preset apps have no DB row.
 *
 *   - A **full custom row** (preset_miniapp_id=NULL, name/url required).
 *
 * `presetMiniappId` is the explicit discriminator (not NULL-pairing on
 * preset fields). User-overridable preset fields are intentionally absent
 * from this table so preset version bumps reach all users immediately
 * (see best-practice-layered-preset-pattern.md §"Update Compatibility").
 */
export const miniAppTable = sqliteTable(
  'mini_app',
  {
    appId: text('app_id').primaryKey(),

    /**
     * If this row inherits from a preset entry, the preset's id (== appId,
     * since miniapp presets share the id space). NULL for pure custom apps.
     * Mirrors `userProviderTable.presetProviderId`.
     */
    presetMiniappId: text('preset_miniapp_id'),

    /** Required for custom apps; NULL for preset override rows. */
    name: text(),
    /** Required for custom apps; NULL for preset override rows. */
    url: text(),
    /** NULL for preset override rows. */
    logo: text(),

    status: text().$type<MiniAppStatus>().notNull().default('enabled'),

    // Fractional-indexing order key, scoped per status (see data-ordering-guide.md)
    ...orderKeyColumns,

    /** NULL for preset override rows. */
    bordered: integer({ mode: 'boolean' }),
    /** NULL for preset override rows. */
    background: text(),
    /** NULL for preset override rows. */
    supportedRegions: text('supported_regions', { mode: 'json' }).$type<MiniAppRegion[]>(),
    /** Reserved for both row shapes; rarely used. */
    configuration: text({ mode: 'json' }),
    /** NULL for preset override rows. */
    nameKey: text(),

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
