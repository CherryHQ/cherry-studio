import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Skill source types
 *
 * - builtin: Ships with the app installation
 * - project: `.agents/skills/` in the project directory
 * - marketplace: Downloaded from the remote marketplace API
 * - local: Installed from a user-specified local directory
 * - zip: Installed from a ZIP package
 */
export type SkillSource = 'builtin' | 'project' | 'marketplace' | 'local' | 'zip'

/**
 * Skill table - global registry for all skills
 *
 * Centralizes metadata for skills from every source.
 * Actual skill content (SKILL.md) is read from the filesystem via `sourcePath`.
 */
export const skillTable = sqliteTable(
  'skill',
  {
    id: uuidPrimaryKey(),

    // metadata
    name: text().notNull(),
    slug: text().notNull().unique(),
    description: text(),
    author: text(),
    version: text(),
    tags: text({ mode: 'json' }).$type<string[]>(),
    tools: text({ mode: 'json' }).$type<string[]>(),

    // source
    source: text().$type<SkillSource>().notNull(),
    sourcePath: text().notNull(),
    packageName: text(),
    packageVersion: text(),
    marketplaceId: text(),

    // content tracking
    contentHash: text(),
    size: integer(),

    // state
    isEnabled: integer({ mode: 'boolean' }).notNull().default(true),

    // version history
    versionDirPath: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('skill_name_idx').on(t.name),
    index('skill_source_idx').on(t.source),
    index('skill_is_enabled_idx').on(t.isEnabled),
    check('skill_source_check', sql`${t.source} IN ('builtin', 'project', 'marketplace', 'local', 'zip')`)
  ]
)

export type SkillInsert = typeof skillTable.$inferInsert
export type SkillSelect = typeof skillTable.$inferSelect

/**
 * Skill version table - tracks content changes as diffs
 *
 * Each row represents a historical snapshot. The actual diff content is stored
 * as a unified-diff `.patch` file on the filesystem at `diffPath`.
 */
export const skillVersionTable = sqliteTable(
  'skill_version',
  {
    id: uuidPrimaryKeyOrdered(),
    skillId: text()
      .notNull()
      .references(() => skillTable.id, { onDelete: 'cascade' }),

    version: text(),
    contentHash: text().notNull(),
    diffPath: text().notNull(),
    message: text(),

    ...createUpdateTimestamps
  },
  (t) => [index('skill_version_skill_id_idx').on(t.skillId, t.createdAt)]
)

export type SkillVersionInsert = typeof skillVersionTable.$inferInsert
export type SkillVersionSelect = typeof skillVersionTable.$inferSelect
