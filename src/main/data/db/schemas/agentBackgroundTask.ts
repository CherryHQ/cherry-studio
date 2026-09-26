import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { BackgroundTaskRecord } from '@shared/ai/backgroundTask'

import { agentTable } from './agent'

/** Durable index for detached task status and GUI control. Logs and completion sentinels stay on disk. */
export const agentBackgroundTaskTable = sqliteTable(
  'agent_background_task',
  {
    id: text().primaryKey(),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    status: text().notNull(),
    record: text({ mode: 'json' }).$type<BackgroundTaskRecord>().notNull(),
    startedAt: text().notNull(),
    finishedAt: text()
  },
  (t) => [index('agent_background_task_agent_started_idx').on(t.agentId, t.startedAt)]
)
