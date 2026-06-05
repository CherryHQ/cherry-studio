import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { BaseMigrator } from '../BaseMigrator'

/**
 * Minimal concrete migrator that exposes the protected `assertOwnedForeignKeys`
 * so it can be exercised directly against a real DB.
 */
class ProbeMigrator extends BaseMigrator {
  readonly id = 'probe'
  readonly name = 'Probe'
  readonly description = 'test-only migrator'
  readonly order = 0
  reset(): void {}
  async prepare(): Promise<PrepareResult> {
    return { success: true, itemCount: 0 }
  }
  async execute(): Promise<ExecuteResult> {
    return { success: true, processedCount: 0 }
  }
  async validate(): Promise<ValidateResult> {
    return { success: true, errors: [], stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 } }
  }
  checkOwnedForeignKeys(db: MigrationContext['db'], tables: Parameters<BaseMigrator['assertOwnedForeignKeys']>[1]) {
    return this.assertOwnedForeignKeys(db, tables)
  }
}

async function insertAgent(db: ReturnType<typeof setupTestDatabase>['db'], id: string) {
  await db
    .insert(agentTable)
    .values({ id, type: 'claude-code', name: 'A', instructions: 'i', model: null, orderKey: 'a0' })
}

async function insertSession(db: ReturnType<typeof setupTestDatabase>['db'], id: string, agentId: string) {
  await db.insert(agentSessionTable).values({ id, agentId, name: 'S', orderKey: 'a0' })
}

describe('BaseMigrator.assertOwnedForeignKeys', () => {
  const dbh = setupTestDatabase()
  const probe = new ProbeMigrator()

  it('throws when an owned table has an unsatisfied foreign key', async () => {
    // FK=OFF lets us stage a dangling reference, mirroring the migration window.
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 'session_x', 'ghost-agent') // agentId not present

    await expect(probe.checkOwnedForeignKeys(dbh.db, [agentSessionTable])).rejects.toThrow(/foreign-key violation/)
  })

  it('does not throw when owned tables are referentially consistent', async () => {
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertAgent(dbh.db, 'a1')
    await insertSession(dbh.db, 's1', 'a1')

    await expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).resolves.toBeUndefined()
  })

  it('aggregates violations across multiple owned tables', async () => {
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_dangling', 'ghost-agent')

    // agentTable is clean; agentSessionTable has the dangling ref — must still throw.
    await expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).rejects.toThrow(
      /ProbeMigrator left \d+ foreign-key violation/
    )
  })

  it('checks only the tables passed in (a dangling ref in an unlisted table is ignored)', async () => {
    await dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_unlisted', 'ghost-agent') // violation lives in agent_session

    // Only agentTable is passed → the agent_session violation is out of scope here.
    await expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable])).resolves.toBeUndefined()
  })
})
