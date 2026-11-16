import { and, eq, inArray, isNull, ne, notExists } from 'drizzle-orm'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'

import type { DbType, ISeeder } from '../../types'

export class AgentSessionMessageTreeSeeder implements ISeeder {
  readonly name = 'agentSessionMessageTree'
  readonly version = '1'
  readonly description = 'Initialize empty Agent session roots and legacy delivery reply anchors'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        for (const session of tx
          .select({ id: sessions.id, updatedAt: sessions.updatedAt })
          .from(sessions)
          .where(
            and(
              isNull(sessions.activeNodeId),
              notExists(
                tx
                  .select({ id: messages.id })
                  .from(messages)
                  .where(and(eq(messages.sessionId, sessions.id), ne(messages.role, 'root')))
              )
            )
          )
          .all()) {
          const rootId = ensureAgentSessionRootTx(tx, session.id)
          tx.update(sessions)
            .set({ activeNodeId: rootId, updatedAt: session.updatedAt })
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
