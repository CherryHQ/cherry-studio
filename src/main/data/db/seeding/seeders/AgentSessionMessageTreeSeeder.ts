import { eq, inArray } from 'drizzle-orm'

import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'

import type { DbType, ISeeder } from '../../types'

export class AgentSessionMessageTreeSeeder implements ISeeder {
  readonly name = 'agentSessionMessageTree'
  readonly version = '1'
  readonly description = 'Backfill legacy Agent delivery reply anchors'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
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
