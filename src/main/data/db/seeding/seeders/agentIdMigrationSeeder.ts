import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentTaskRunLogTable, agentTaskTable } from '@data/db/schemas/agentTask'
import type { DbType, ISeeder } from '@data/db/types'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export class AgentIdMigrationSeeder implements ISeeder {
  readonly name = 'agentIdMigration'
  readonly version = '1'
  readonly description = 'Migrate agent/session/task rows with old-format prefix IDs to UUID v4'

  async run(db: DbType): Promise<void> {
    // PRAGMA foreign_keys cannot be changed inside a transaction; set it before.
    await db.run(sql`PRAGMA foreign_keys = OFF`)
    try {
      await db.transaction(async (tx) => {
        // 1. Migrate agent IDs (prefix "agent_*" and hardcoded builtin IDs)
        const oldAgents = await tx
          .select({ id: agentTable.id })
          .from(agentTable)
          .where(
            sql`${agentTable.id} GLOB 'agent_*' OR ${agentTable.id} = 'cherry-claw-default' OR ${agentTable.id} = 'cherry-assistant-default'`
          )

        for (const { id: oldId } of oldAgents) {
          const newId = uuidv4()
          await tx.update(agentTable).set({ id: newId }).where(eq(agentTable.id, oldId))
          await tx.update(agentSessionTable).set({ agentId: newId }).where(eq(agentSessionTable.agentId, oldId))
          await tx.update(agentSkillTable).set({ agentId: newId }).where(eq(agentSkillTable.agentId, oldId))
          await tx.update(agentTaskTable).set({ agentId: newId }).where(eq(agentTaskTable.agentId, oldId))
          await tx.update(agentChannelTable).set({ agentId: newId }).where(eq(agentChannelTable.agentId, oldId))
        }

        // 2. Migrate session IDs
        const oldSessions = await tx
          .select({ id: agentSessionTable.id })
          .from(agentSessionTable)
          .where(sql`${agentSessionTable.id} GLOB 'session_*'`)

        for (const { id: oldId } of oldSessions) {
          const newId = uuidv4()
          await tx.update(agentSessionTable).set({ id: newId }).where(eq(agentSessionTable.id, oldId))
          await tx
            .update(agentSessionMessageTable)
            .set({ sessionId: newId })
            .where(eq(agentSessionMessageTable.sessionId, oldId))
          await tx.update(agentChannelTable).set({ sessionId: newId }).where(eq(agentChannelTable.sessionId, oldId))
          await tx
            .update(agentTaskRunLogTable)
            .set({ sessionId: newId })
            .where(eq(agentTaskRunLogTable.sessionId, oldId))
        }

        // 3. Migrate task IDs
        const oldTasks = await tx
          .select({ id: agentTaskTable.id })
          .from(agentTaskTable)
          .where(sql`${agentTaskTable.id} GLOB 'task_*'`)

        for (const { id: oldId } of oldTasks) {
          const newId = uuidv4()
          await tx.update(agentTaskTable).set({ id: newId }).where(eq(agentTaskTable.id, oldId))
          await tx.update(agentTaskRunLogTable).set({ taskId: newId }).where(eq(agentTaskRunLogTable.taskId, oldId))
          await tx.update(agentChannelTaskTable).set({ taskId: newId }).where(eq(agentChannelTaskTable.taskId, oldId))
        }
      })
    } finally {
      await db.run(sql`PRAGMA foreign_keys = ON`)
    }
  }
}
