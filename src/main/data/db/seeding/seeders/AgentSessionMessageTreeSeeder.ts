import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'

import type { DbType, ISeeder } from '../../types'

export class AgentSessionMessageTreeSeeder implements ISeeder {
  readonly name = 'agentSessionMessageTree'
  readonly version = '1'
  readonly description = 'Preserve flat Agent archives as one selected message path'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        for (const session of tx
          .select({ id: sessions.id, updatedAt: sessions.updatedAt })
          .from(sessions)
          .where(isNull(sessions.activeNodeId))
          .all()) {
          const rootId = ensureAgentSessionRootTx(tx, session.id)
          tx.run(sql`
            WITH ordered AS (
              SELECT id, lag(id, 1, ${rootId}) OVER (ORDER BY created_at, id) AS parent_id
              FROM agent_session_message WHERE session_id = ${session.id} AND role != 'root'
            )
            UPDATE agent_session_message SET parent_id = ordered.parent_id
            FROM ordered WHERE agent_session_message.id = ordered.id
          `)
          const leaf = tx
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.sessionId, session.id), ne(messages.role, 'root')))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .get()
          tx.update(sessions)
            .set({ activeNodeId: leaf?.id ?? rootId, updatedAt: session.updatedAt })
            .where(eq(sessions.id, session.id))
            .run()
        }
        for (const request of tx
          .select()
          .from(messages)
          .where(inArray(messages.deliveryStatus, ['accepted', 'delivering']))
          .all()) {
          if (request.delivery?.replyPolicy !== 'completion' || request.data.deliveryReplyAnchor) continue
          const sender = tx.select().from(sessions).where(eq(sessions.id, request.delivery.sender.sessionId)).get()
          if (sender?.activeNodeId) {
            tx.update(messages)
              .set({
                data: { ...request.data, deliveryReplyAnchor: sender.activeNodeId },
                updatedAt: request.updatedAt
              })
              .where(eq(messages.id, request.id))
              .run()
          }
        }
      },
      { behavior: 'immediate' }
    )
  }
}
