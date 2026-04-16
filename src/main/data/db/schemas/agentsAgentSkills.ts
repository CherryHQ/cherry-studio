import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'
import { agentsGlobalSkillsTable } from './agentsSkills'

/**
 * Per-agent skill enablement join table.
 *
 * A row here records whether skill X is enabled for agent Y. Only rows with
 * `isEnabled = true` correspond to an actual symlink under the agent's
 * workspace `.claude/skills/` directory.
 */
export const agentsAgentSkillsTable = sqliteTable(
  'agents_agent_skills',
  {
    agentId: text()
      .notNull()
      .references(() => agentsAgentsTable.id, { onDelete: 'cascade' }),
    skillId: text()
      .notNull()
      .references(() => agentsGlobalSkillsTable.id, { onDelete: 'cascade' }),
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
