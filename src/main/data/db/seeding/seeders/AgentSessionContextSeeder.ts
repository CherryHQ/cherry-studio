import { and, eq, or } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable as backends } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable as contexts } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { listRetiredAgentSessionMigrations } from '@data/services/retiredAgentRuntimeMigration'

import type { DbType, ISeeder } from '../../types'

export class AgentSessionContextSeeder implements ISeeder {
  readonly name = 'agentSessionContext'
  readonly version = '1'
  readonly description = 'Record existing Pi context identities for later native verification'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        const migrations = new Map(
          listRetiredAgentSessionMigrations(tx).map((migration) => [migration.sessionId, migration.resumeToken])
        )
        const sessions = tx
          .select({ id: agentSessionTable.id, type: agentTable.type })
          .from(agentSessionTable)
          .leftJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
          .all()
        const locator = { version: 1, kind: 'pi' } as const
        let backend = tx.select().from(backends).where(eq(backends.locator, locator)).get()

        for (const session of sessions) {
          const migratedId = migrations.get(session.id)
          if (!migratedId && session.type !== 'pi') continue
          // Pending DSH conversion owns a new Pi identity; its old message tokens still belong to DSH.
          const ids = migratedId
            ? [migratedId]
            : tx
                .select({ token: agentSessionMessageTable.runtimeResumeToken, data: agentSessionMessageTable.data })
                .from(agentSessionMessageTable)
                .where(eq(agentSessionMessageTable.sessionId, session.id))
                .all()
                .flatMap((row) => [row.token, row.data.nativeSessionId])

          for (const id of new Set(ids)) {
            if (typeof id !== 'string' || !id.trim()) continue
            backend ??= tx.insert(backends).values({ locator, state: 'bound' }).returning().get()
            const existing = tx
              .select({ id: contexts.id })
              .from(contexts)
              .where(
                and(
                  eq(contexts.sessionId, session.id),
                  eq(contexts.backendId, backend.id),
                  or(eq(contexts.intendedThreadId, id), eq(contexts.nativeThreadId, id))
                )
              )
              .get()
            if (!existing) {
              tx.insert(contexts).values({ sessionId: session.id, backendId: backend.id, intendedThreadId: id }).run()
            }
          }
        }
      },
      { behavior: 'immediate' }
    )
  }
}
