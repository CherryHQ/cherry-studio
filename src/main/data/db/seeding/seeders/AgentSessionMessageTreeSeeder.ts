import { asc, eq, inArray } from 'drizzle-orm'

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
        for (const session of tx.select().from(sessions).all()) {
          if (session.activeNodeId) continue
          const rows = tx
            .select({ id: messages.id, role: messages.role, updatedAt: messages.updatedAt })
            .from(messages)
            .where(eq(messages.sessionId, session.id))
            .orderBy(asc(messages.createdAt), asc(messages.id))
            .all()
          let parentId = ensureAgentSessionRootTx(tx, session.id)
          for (const row of rows.filter((row) => row.role !== 'root')) {
            tx.update(messages).set({ parentId, updatedAt: row.updatedAt }).where(eq(messages.id, row.id)).run()
            parentId = row.id
          }
          tx.update(sessions)
            .set({ activeNodeId: parentId, updatedAt: session.updatedAt })
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
