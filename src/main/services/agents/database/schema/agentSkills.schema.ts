/**
 * Drizzle ORM schema for agent_skills join table.
 *
 * Replaces the legacy global `skills.is_enabled` flag with per-agent
 * enablement state. A row here means: "skill X is enabled for agent Y,
 * with a workspace symlink created under agent Y's workdir".
 *
 * Only rows with `is_enabled = true` correspond to an actual symlink on
 * disk. Rows with `is_enabled = false` may also exist to remember an
 * explicit user choice.
 */

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsTable } from './agents.schema'
import { skillsTable } from './skills.schema'

export const agentSkillsTable = sqliteTable(
  'agent_skills',
  {
    agent_id: text('agent_id')
      .notNull()
      .references(() => agentsTable.id, { onDelete: 'cascade' }),
    skill_id: text('skill_id')
      .notNull()
      .references(() => skillsTable.id, { onDelete: 'cascade' }),
    is_enabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(false),
    created_at: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updated_at: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    primaryKey({ columns: [t.agent_id, t.skill_id] }),
    index('idx_agent_skills_agent_id').on(t.agent_id),
    index('idx_agent_skills_skill_id').on(t.skill_id)
  ]
)

export type AgentSkillRow = typeof agentSkillsTable.$inferSelect
export type InsertAgentSkillRow = typeof agentSkillsTable.$inferInsert
