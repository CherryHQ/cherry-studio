import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'
import { agentsSkillsTable } from './agentsSkills'

/**
 * Per-agent skill enablement join table.
 *
 * Replaces the legacy global `agents_skills.is_enabled` flag with per-agent
 * enablement state. A row here means: "skill X is enabled/disabled for agent Y".
 * Only rows with `is_enabled = true` correspond to an actual symlink on disk.
 */
export const agentsAgentSkillsTable = sqliteTable(
  'agents_agent_skills',
  {
    agentId: text()
      .notNull()
      .references(() => agentsAgentsTable.id, { onDelete: 'cascade' }),
    skillId: text()
      .notNull()
      .references(() => agentsSkillsTable.id, { onDelete: 'cascade' }),
    isEnabled: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('agents_agent_skills_agent_id_idx').on(t.agentId),
    index('agents_agent_skills_skill_id_idx').on(t.skillId)
  ]
)

export type AgentsAgentSkillRow = typeof agentsAgentSkillsTable.$inferSelect
export type InsertAgentsAgentSkillRow = typeof agentsAgentSkillsTable.$inferInsert
