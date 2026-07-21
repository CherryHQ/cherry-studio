import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { BaseMigrator } from '../BaseMigrator'

class ProbeMigrator extends BaseMigrator {
  readonly id = 'note'
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
  diagnosedWrite<T>(write: () => T): T {
    return this.runDiagnosedWrite(write)
  }
}

class ExecuteFailureProbe extends ProbeMigrator {
  constructor(private readonly outcome: 'failed' | 'swallowed') {
    super()
  }

  override async execute(): Promise<ExecuteResult> {
    const native = Object.assign(new Error('PRIVATE_OUTER_ERROR'), {
      cause: Object.assign(new Error('PRIVATE_NATIVE_ERROR'), { code: 'SQLITE_TOOBIG' })
    })
    try {
      this.runDiagnosedWrite(() => {
        throw native
      })
    } catch {
      return this.outcome === 'failed'
        ? { success: false, processedCount: 0, error: 'diagnosed failure' }
        : { success: true, processedCount: 1 }
    }
    throw new Error('Test write unexpectedly completed')
  }
}

async function insertAgent(db: ReturnType<typeof setupTestDatabase>['db'], id: string) {
  await db
    .insert(agentTable)
    .values({ id, type: 'claude-code', name: 'A', instructions: 'i', model: null, orderKey: 'a0' })
}

async function insertSession(db: ReturnType<typeof setupTestDatabase>['db'], id: string, agentId: string) {
  const workspaceId = `workspace-${id}`
  await db.insert(agentWorkspaceTable).values({
    id: workspaceId,
    name: workspaceId,
    path: `/tmp/${workspaceId}`,
    type: 'user',
    orderKey: 'a0'
  })
  await db.insert(agentSessionTable).values({ id, agentId, name: 'S', workspaceId, orderKey: 'a0' })
}

const probe = new ProbeMigrator()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BaseMigrator.assertOwnedForeignKeys', () => {
  const dbh = setupTestDatabase()

  it('throws when an owned table has an unsatisfied foreign key', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 'session_x', 'ghost-agent')

    expect(() => probe.checkOwnedForeignKeys(dbh.db, [agentSessionTable])).toThrow(/foreign-key violation/)
  })

  it('does not throw when owned tables are referentially consistent', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertAgent(dbh.db, 'a1')
    await insertSession(dbh.db, 's1', 'a1')

    expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).toBeUndefined()
  })

  it('checks only the tables passed in', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_unlisted', 'ghost-agent')

    expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable])).toBeUndefined()
  })

  it('aggregates violations across multiple owned tables', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_dangling', 'ghost-agent')

    expect(() => probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).toThrow(
      /ProbeMigrator left \d+ foreign-key violation/
    )
  })
})

describe('BaseMigrator failure-only write diagnosis', () => {
  it('returns the exact synchronous result', () => {
    const result = { inserted: 1 }

    expect(probe.diagnosedWrite(() => result)).toBe(result)
  })

  it('rethrows the original synchronous error and exposes one fixed failure to the phase owner', async () => {
    const original = Object.assign(new Error('PRIVATE_WRAPPER'), {
      cause: Object.assign(new Error('PRIVATE_NATIVE'), { code: 'SQLITE_TOOBIG' })
    })
    const migrator = new (class extends ProbeMigrator {
      override async execute(): Promise<ExecuteResult> {
        try {
          this.runDiagnosedWrite(() => {
            throw original
          })
        } catch (error) {
          expect(error).toBe(original)
          return { success: false, processedCount: 0, error: 'failed' }
        }
        throw new Error('unreachable')
      }
    })()

    const diagnosed = await migrator.executeWithDiagnostics({} as never)

    expect(diagnosed).toEqual({
      result: { success: false, processedCount: 0, error: 'failed' },
      failure: {
        classification: { errorCode: 'sqlite_too_big' }
      }
    })
    expect(JSON.stringify(diagnosed)).not.toContain('PRIVATE_')
  })

  it('returns a captured classification only for a failed phase result', async () => {
    const failed = await new ExecuteFailureProbe('failed').executeWithDiagnostics({} as MigrationContext)
    const swallowed = await new ExecuteFailureProbe('swallowed').executeWithDiagnostics({} as MigrationContext)

    expect(failed).toMatchObject({
      result: { success: false },
      failure: {
        classification: { errorCode: 'sqlite_too_big' }
      }
    })
    expect(swallowed).toEqual({ result: { success: true, processedCount: 1 } })
  })
})
