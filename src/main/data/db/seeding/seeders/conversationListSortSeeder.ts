import { and, asc, eq, isNull, notInArray } from 'drizzle-orm'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { pinTable } from '@data/db/schemas/pin'
import { preferenceTable } from '@data/db/schemas/preference'
import { topicTable } from '@data/db/schemas/topic'
import type { ConversationListSort } from '@shared/data/types/conversationList'

import type { DbType, ISeeder } from '../../types'

export class ConversationListSortSeeder implements ISeeder {
  readonly name = 'conversationListSort'
  readonly description = 'Preserve existing conversation order when initializing independent sorting'
  readonly version = '1'

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        for (const entityType of ['topic', 'session'] as const) {
          const key = entityType === 'topic' ? 'chat.topics.sort' : 'agent.session.sort'
          const existing = tx
            .select({ key: preferenceTable.key })
            .from(preferenceTable)
            .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
            .get()
          if (existing) continue

          const table = entityType === 'topic' ? topicTable : agentSessionTable
          const pins = tx.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, entityType))
          const rows = tx
            .select({ createdAt: table.createdAt })
            .from(table)
            .where(
              and(
                isNull(table.deletedAt),
                notInArray(table.id, pins),
                entityType === 'session'
                  ? and(eq(agentSessionTable.type, 'conversation'), isNull(agentSessionTable.taskId))
                  : undefined
              )
            )
            .orderBy(asc(table.orderKey), asc(table.id))
            .all()
          const customOrder = rows.some((row, index) => index > 0 && row.createdAt > rows[index - 1].createdAt)
          const value: ConversationListSort = customOrder
            ? { by: 'orderKey' }
            : { by: 'lastActivityAt', direction: 'desc' }
          tx.insert(preferenceTable).values({ scope: 'default', key, value }).run()
        }
      },
      { behavior: 'immediate' }
    )
  }
}
