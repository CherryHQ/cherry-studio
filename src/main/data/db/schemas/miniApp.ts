/**
 * MiniApp table schema
 *
 * Stores user's miniapp configurations and preferences
 * Supports both system default apps and user-customized apps
 *
 * `mini_app_installation` and `mini_app_grant` are its satellites (FK cascade,
 * `kind='app'` rows only) and live here, like `knowledge_item` beside `knowledge_base`.
 */

import type { MiniAppManifest } from '@shared/types/miniAppManifest'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

export type MiniAppStatus = 'enabled' | 'disabled' | 'pinned'

export type MiniAppRegion = 'CN' | 'Global'

export type MiniAppKind = 'site' | 'app'

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

    /**
     * 'site' = remote URL in a shared partition, zero host capabilities.
     * 'app'  = installed package with its own partition, origin and grants.
     */
    kind: text().$type<MiniAppKind>().notNull().default('site'),

    name: text().notNull(),
    url: text().notNull(),

    /**
     * Preset/bundled logo reference — a `getMiniAppsLogo` icon id (e.g.
     * `'application'`) or a custom app's URL. A user-uploaded custom logo has no
     * key here: it lives solely in the `mini_app_logo_file_ref` table (the
     * single source of truth), resolved back via `getSingleFileRefId`.
     */
    logoKey: text('logo_key'),

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
    check('mini_app_status_check', sql`${t.status} IN ('enabled', 'disabled', 'pinned')`),
    check('mini_app_kind_check', sql`${t.kind} IN ('site', 'app')`)
  ]
)

export type MiniAppRow = typeof miniAppTable.$inferSelect
export type InsertMiniAppRow = typeof miniAppTable.$inferInsert

export type MiniAppInstallSource = 'file' | 'url' | 'builtin'

/**
 * How a `kind='app'` mini app reached this machine, and which version is live.
 *
 * Named for the act, not the artifact: every column is a property of installing
 * (source, path, hash, timestamps), not of the packaged code.
 */
export const miniAppInstallationTable = sqliteTable(
  'mini_app_installation',
  {
    appId: text('app_id')
      .primaryKey()
      .references(() => miniAppTable.appId, { onDelete: 'cascade' }),

    version: text().notNull(),
    /** Tree hash of the installed directory — detects tampering and no-op updates. */
    contentHash: text('content_hash').notNull(),
    // NO installPath column: userData relocation moves the tree, so a persisted
    // absolute path goes stale. Derive it from the packages root + appId.

    source: text().$type<MiniAppInstallSource>().notNull(),
    sourceUrl: text('source_url'),
    /** Origin pinned at install time; updates from any other origin are refused. */
    sourceOrigin: text('source_origin'),
    /**
     * The China accelerator's origin, pinned alongside `sourceOrigin` at install when the
     * manifest declares one. NULL when it does not, and always for `'file'` / `'builtin'`.
     * An update may neither add nor drop it: that would be the app walking its own supply
     * chain somewhere the user never approved.
     */
    sourceOriginCn: text('source_origin_cn'),

    manifestJson: text('manifest_json', { mode: 'json' }).$type<MiniAppManifest>().notNull(),
    /**
     * The version replaced by the most recent update. Rollback restores the whole
     * record from these — restoring only the directory yields "files are v1, rows
     * say v2", which is harder to diagnose than a failed update.
     */
    previousManifestJson: text('previous_manifest_json', { mode: 'json' }).$type<MiniAppManifest>(),
    previousContentHash: text('previous_content_hash'),
    /**
     * The grant keys actually held when the update started — NOT derivable from
     * `previousManifestJson`. A manifest records what was *declared*; the user may
     * have revoked part of it. Rebuilding grants from the old manifest on rollback
     * would hand back permissions they took away, which is the one thing a rollback
     * must never do.
     */
    previousGrantsJson: text('previous_grants_json', { mode: 'json' }).$type<string[]>(),
    previousConsentedDeclaredJson: text('previous_consented_declared_json', { mode: 'json' }).$type<string[]>(),
    /**
     * The EXPANDED declared set the user last consented to.
     *
     * Not derivable from `manifestJson`: a manifest says `storage.*`, and what that
     * expanded to depends on which methods existed at consent time. When a Cherry
     * release adds a method under a namespace the app declared with a wildcard, this
     * is the column that tells the difference between "the host grew the namespace"
     * (ask the user) and "the user revoked this" (leave it alone). Comparing against
     * the current grants alone cannot distinguish the two, and getting it wrong means
     * either nagging forever or silently re-granting something the user removed.
     */
    consentedDeclaredJson: text('consented_declared_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /**
     * DELIBERATE EXCEPTION to this table's "every column is a property of
     * installing" rule: the user's model choices for this mini app (null = the
     * matching global model). They live here because this is the only per-local-app
     * row and a whole table for two nullable columns is not worth it — noted as an
     * exception rather than widening the rule above until it stops objecting.
     */
    aiModelId: text('ai_model_id'),
    aiQuickModelId: text('ai_quick_model_id'),

    ...createUpdateTimestamps
  },
  (t) => [
    check('mai_source_check', sql`${t.source} IN ('file', 'url', 'builtin')`),
    // The four snapshot columns are ONE fact. A row holding three of them promises a
    // rollback it cannot perform, and the panel renders its button off that promise.
    check(
      'mai_rollback_snapshot_all_or_none',
      sql`(${t.previousContentHash} IS NULL AND ${t.previousManifestJson} IS NULL
           AND ${t.previousGrantsJson} IS NULL AND ${t.previousConsentedDeclaredJson} IS NULL)
          OR (${t.previousContentHash} IS NOT NULL AND ${t.previousManifestJson} IS NOT NULL
              AND ${t.previousGrantsJson} IS NOT NULL AND ${t.previousConsentedDeclaredJson} IS NOT NULL)`
    ),
    // `sourceOriginCn` is free for 'url': the accelerator is whatever the manifest declared.
    check(
      'mai_source_consistency',
      sql`(${t.source} IN ('file', 'builtin') AND ${t.sourceUrl} IS NULL AND ${t.sourceOrigin} IS NULL
           AND ${t.sourceOriginCn} IS NULL)
          OR (${t.source} = 'url' AND ${t.sourceUrl} IS NOT NULL AND ${t.sourceOrigin} IS NOT NULL)`
    )
  ]
)

/**
 * `$type<…>()` on every JSON column is not decoration. Without it Drizzle infers
 * `unknown`, and every reader has to write `as string[]` — a cast that is invisible to
 * review, repeated at each call site, and wrong the moment the column's real shape
 * changes. Declaring it once at the schema is the upstream fix; the casts downstream
 * were the workaround.
 */
export type MiniAppInstallationRow = typeof miniAppInstallationTable.$inferSelect
export type InsertMiniAppInstallationRow = typeof miniAppInstallationTable.$inferInsert

/**
 * What the USER granted — deliberately distinct from what the manifest declares.
 *
 * "Did this update widen permissions?" is exactly the diff between the declared
 * set and these rows; a single merged representation cannot express it.
 * Capability leaves only. Hosts are NOT grants — nothing can revoke one individually,
 * and an unrevokable "permission" is just a parameter (design §7).
 */
export const miniAppGrantTable = sqliteTable(
  'mini_app_grant',
  {
    id: uuidPrimaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => miniAppTable.appId, { onDelete: 'cascade' }),
    /**
     * A capability leaf, never a host. Whether it was declared required or optional is
     * NOT stored: that is a property of the current manifest, and a copy here would go
     * stale the moment an update moves an entry between the two arrays — leaving reset
     * to revoke something that has since become a precondition of the install.
     */
    permission: text().notNull(),
    /** Manifest version at grant time — shown when an update asks for more. */
    grantedVersion: text('granted_version').notNull(),
    ...createUpdateTimestamps
  },
  (t) => [uniqueIndex('mag_app_permission_unique_idx').on(t.appId, t.permission)]
)

export type MiniAppGrantRow = typeof miniAppGrantTable.$inferSelect
