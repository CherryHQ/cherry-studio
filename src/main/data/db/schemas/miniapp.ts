/**
 * MiniApp table schema
 *
 * Stores user's miniapp configurations and preferences
 * Supports both system default apps and user-customized apps
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export type MiniAppStatus = 'enabled' | 'disabled' | 'pinned'

export type MiniAppKind = 'default' | 'custom'

export type MiniAppRegion = 'CN' | 'Global'

export const miniAppTable = sqliteTable(
  'miniapp',
  {
    appId: text('app_id').primaryKey(),
    // Display name
    name: text().notNull(),
    // App URL (webview source)
    url: text().notNull(),

    // Logo URL or base64 data
    logo: text(),

    // App type: default (system) or custom (user-added)
    type: text().$type<MiniAppKind>().notNull().default('custom'),

    // User status for this app
    status: text().$type<MiniAppStatus>().notNull().default('enabled'),

    // Sort order within the same status group
    sortOrder: integer('sort_order').notNull().default(0),

    // Whether the app shows a border
    bordered: integer({ mode: 'boolean' }).default(true),

    // Background color
    background: text(),

    // Region availability
    supportedRegions: text('supported_regions', { mode: 'json' }).$type<MiniAppRegion[]>(),

    // Custom configuration
    configuration: text({ mode: 'json' }),

    // i18n key for translatable names
    nameKey: text(),

    // Timestamps
    ...createUpdateTimestamps
  },
  (t) => [
    index('miniapp_status_sort_idx').on(t.status, t.sortOrder),
    index('miniapp_type_idx').on(t.type),
    index('miniapp_status_type_idx').on(t.status, t.type),
    check('miniapp_status_check', sql`${t.status} IN ('enabled', 'disabled', 'pinned')`),
    check('miniapp_type_check', sql`${t.type} IN ('default', 'custom')`)
  ]
)

export type MiniAppSelect = typeof miniAppTable.$inferSelect
export type MiniAppInsert = typeof miniAppTable.$inferInsert
