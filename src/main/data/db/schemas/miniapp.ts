/**
 * MiniApp table schema
 *
 * Stores user's miniapp configurations and preferences
 * Supports both system default apps and user-customized apps
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

export type MiniAppStatus = 'enabled' | 'disabled' | 'pinned'

export type MiniAppType = 'default' | 'custom'

export type MiniAppRegion = 'CN' | 'Global'

export const miniappTable = sqliteTable(
  'miniapp',
  {
    id: uuidPrimaryKey(),
    // Display name
    name: text().notNull(),
    // App identifier
    appId: text('app_id').notNull(),
    // App URL (webview source)
    url: text().notNull(),

    // Logo URL or base64 data
    logo: text(),

    // App type: default (system) or custom (user-added)
    type: text().$type<MiniAppType>().notNull().default('default'),

    // User status for this app
    status: text().$type<MiniAppStatus>().notNull().default('enabled'),

    // Sort order within the same status group
    sortOrder: integer('sort_order').default(0),

    // Whether the app shows a border
    bordered: integer({ mode: 'boolean' }).default(true),

    // Background color
    background: text(),

    // Region availability
    supportedRegions: text('supported_regions', { mode: 'json' }).$type<MiniAppRegion[]>(),

    // Custom configuration
    configuration: text({ mode: 'json' }),

    // Metadata
    nameKey: text(),

    // Additional timestamps
    addedAt: integer('added_at'),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('miniapp_status_sort_idx').on(t.status, t.sortOrder),
    index('miniapp_app_id_idx').on(t.appId),
    index('miniapp_type_idx').on(t.type),
    index('miniapp_status_type_idx').on(t.status, t.type)
  ]
)

export type MiniAppRow = typeof miniappTable.$inferSelect
export type InsertMiniAppRow = typeof miniappTable.$inferInsert
