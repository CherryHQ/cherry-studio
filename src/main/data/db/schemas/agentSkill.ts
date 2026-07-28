import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentTable } from './agent'
import { agentGlobalSkillTable } from './agentGlobalSkill'

/**
 * Per-agent skill enablement join table.
 *
 * A row here records whether skill X is enabled for agent Y. Only rows with
 * `isEnabled = true` correspond to an actual symlink under the agent's
 * workspace `.claude/skills/` directory.
 */
export const agentSkillTable = sqliteTable(
  'agent_skill',
  {
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    skillId: text()
      .notNull()
      .references(() => agentGlobalSkillTable.id, { onDelete: 'cascade' }),
    isEnabled: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('agent_skill_agent_id_idx').on(t.agentId),
    index('agent_skill_skill_id_idx').on(t.skillId)
  ]
)

export type AgentSkillRow = typeof agentSkillTable.$inferSelect
export type InsertAgentSkillRow = typeof agentSkillTable.$inferInsert
