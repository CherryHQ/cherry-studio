import { eq, isNull, ne, sql } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { listRetiredAgentSessionMigrations } from '@data/services/retiredAgentRuntimeMigration'
import { AgentTypeSchema } from '@shared/data/api/schemas/agents'

import type { DbType, ISeeder } from '../../types'

export class AgentSessionRuntimeSeeder implements ISeeder {
  readonly name = 'agentSessionRuntime'
  readonly version = '1'
  readonly description = 'Bind historical session runtimes before unifying Agents on Pi Durable'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        const retired = new Set(listRetiredAgentSessionMigrations(tx).map(({ sessionId }) => sessionId))
        const sessions = tx
          .select({ id: agentSessionTable.id, type: agentTable.type })
          .from(agentSessionTable)
          .leftJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
          .where(isNull(agentSessionTable.runtimeType))
          .all()
        for (const session of sessions) {
          const kinds = new Set(
            tx
              .select({ locator: agentRuntimeBackendTable.locator })
              .from(agentSessionContextTable)
              .innerJoin(agentRuntimeBackendTable, eq(agentSessionContextTable.backendId, agentRuntimeBackendTable.id))
              .where(eq(agentSessionContextTable.sessionId, session.id))
              .all()
              .map(({ locator }) => locator.kind)
          )
          if (retired.has(session.id)) kinds.add('pi')
          const candidate = kinds.size
            ? kinds.size === 1
              ? [...kinds][0]
              : undefined
            : session.type === 'cherry-claw'
              ? 'claude-code'
              : session.type
          const runtimeType = AgentTypeSchema.safeParse(candidate).data ?? 'unknown'
          tx.update(agentSessionTable)
            .set({ runtimeType, updatedAt: sql`${agentSessionTable.updatedAt}` })
            .where(eq(agentSessionTable.id, session.id))
            .run()
        }
        tx.update(agentTable)
          .set({ type: 'pi-durable', updatedAt: sql`${agentTable.updatedAt}` })
          .where(ne(agentTable.type, 'pi-durable'))
          .run()
      },
      { behavior: 'immediate' }
    )
  }
}
