import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import type { PayloadProfileDescriptor } from '../../diagnostics'
import * as payloadProfiler from '../../diagnostics/payloadLengthProfiler'
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
  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    void ctx
    return { success: true, processedCount: 0 }
  }
  async validate(): Promise<ValidateResult> {
    return { success: true, errors: [], stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 } }
  }
  checkOwnedForeignKeys(db: MigrationContext['db'], tables: Parameters<BaseMigrator['assertOwnedForeignKeys']>[1]) {
    return this.assertOwnedForeignKeys(db, tables)
  }
  diagnosedWrite<T>(
    ctx: MigrationContext,
    descriptor: PayloadProfileDescriptor,
    rows: readonly unknown[],
    write: () => T
  ): T {
    return this.runDiagnosedWrite(ctx, descriptor, rows, write)
  }
  diagnosedAsyncWrite<T>(
    ctx: MigrationContext,
    descriptor: PayloadProfileDescriptor,
    rows: () => Parameters<typeof payloadProfiler.profilePayloadLengths>[0],
    write: () => Promise<T>
  ): Promise<T> {
    return this.runDiagnosedAsyncWrite(ctx, descriptor, rows, write)
  }
}

class ExecuteCaptureProbeMigrator extends ProbeMigrator {
  constructor(private readonly outcome: 'failed' | 'best_effort_success' | 'best_effort_then_unrelated') {
    super()
  }

  override async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const original = Object.assign(new Error('private diagnosed failure'), { code: 'SQLITE_TOOBIG' })
    try {
      this.runDiagnosedWrite(ctx, { target: 'message', fields: ['content'] }, [{ content: 'PRIVATE_VALUE' }], () => {
        throw original
      })
    } catch {
      if (this.outcome === 'best_effort_success') {
        return { success: true, processedCount: 1 }
      }
      if (this.outcome === 'best_effort_then_unrelated') {
        ;(this as unknown as { clearNonterminalDiagnosedFailure(): void }).clearNonterminalDiagnosedFailure()
        return { success: false, processedCount: 0, error: 'unrelated failure' }
      }
      return { success: false, processedCount: 0, error: 'diagnosed failure' }
    }
    throw new Error('Test write unexpectedly completed')
  }
}

type PhaseOutcome = 'captured_failure' | 'captured_success' | 'plain_failure' | 'success'

class PhaseCaptureProbeMigrator extends ProbeMigrator {
  prepareOutcomes: PhaseOutcome[] = []
  validateOutcomes: PhaseOutcome[] = []

  private capture(error: unknown): void {
    ;(this as unknown as { capturePhaseFailure(error: unknown): void }).capturePhaseFailure(error)
  }

  override async prepare(): Promise<PrepareResult> {
    const outcome = this.prepareOutcomes.shift() ?? 'success'
    if (outcome.startsWith('captured')) {
      this.capture(Object.assign(new Error('PRIVATE_PREPARE_ERROR'), { code: 'SQLITE_TOOBIG' }))
    }
    return outcome.endsWith('success')
      ? { success: true, itemCount: 0 }
      : { success: false, itemCount: 0, error: 'prepare failed' }
  }

  override async validate(): Promise<ValidateResult> {
    const outcome = this.validateOutcomes.shift() ?? 'success'
    if (outcome.startsWith('captured')) {
      this.capture(Object.assign(new Error('PRIVATE_VALIDATE_ERROR'), { code: 'SQLITE_CORRUPT' }))
    }
    return outcome.endsWith('success')
      ? { success: true, errors: [], stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 } }
      : {
          success: false,
          errors: [{ key: 'validation', message: 'validate failed' }],
          stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
        }
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
    // FK=OFF lets us stage a dangling reference, mirroring the migration window.
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 'session_x', 'ghost-agent') // agentId not present

    expect(() => probe.checkOwnedForeignKeys(dbh.db, [agentSessionTable])).toThrow(/foreign-key violation/)
  })

  it('does not throw when owned tables are referentially consistent', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertAgent(dbh.db, 'a1')
    await insertSession(dbh.db, 's1', 'a1')

    expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).toBeUndefined()
  })

  it('aggregates violations across multiple owned tables', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_dangling', 'ghost-agent')

    // agentTable is clean; agentSessionTable has the dangling ref — must still throw.
    expect(() => probe.checkOwnedForeignKeys(dbh.db, [agentTable, agentSessionTable])).toThrow(
      /ProbeMigrator left \d+ foreign-key violation/
    )
  })

  it('checks only the tables passed in (a dangling ref in an unlisted table is ignored)', async () => {
    dbh.db.run(sql`PRAGMA foreign_keys = OFF`)
    await insertSession(dbh.db, 's_unlisted', 'ghost-agent') // violation lives in agent_session

    // Only agentTable is passed → the agent_session violation is out of scope here.
    expect(probe.checkOwnedForeignKeys(dbh.db, [agentTable])).toBeUndefined()
  })
})

describe('BaseMigrator.runDiagnosedWrite', () => {
  const descriptor = { target: 'message', fields: ['content'] } as const satisfies PayloadProfileDescriptor

  function createMigrationRun(recordEvent = vi.fn()): MigrationContext {
    return {
      diagnostics: { recordEvent },
      logger: { error: vi.fn() },
      db: { transaction: vi.fn() }
    } as unknown as MigrationContext
  }

  it('returns the exact synchronous write result without profiling or opening a transaction', () => {
    const migrationRun = createMigrationRun()
    const rows = Object.freeze([{ content: 'private-value' }])
    const profileSpy = vi.spyOn(payloadProfiler, 'profilePayloadLengths')
    const result = { inserted: 1 }

    expect(probe.diagnosedWrite(migrationRun, descriptor, rows, () => result)).toBe(result)
    expect(profileSpy).not.toHaveBeenCalled()
    expect(migrationRun.diagnostics.recordEvent).not.toHaveBeenCalled()
    expect(migrationRun.db.transaction).not.toHaveBeenCalled()
  })

  it('profiles only on failure and rethrows the original SQLITE_TOOBIG object unchanged', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const recordEvent = vi.fn()
    const migrationRun = createMigrationRun(recordEvent)
    const canary = `PRIVATE_MESSAGE_CANARY_${'x'.repeat(300_000)}`
    const rows = [{ content: canary }]
    const profileSpy = vi.spyOn(payloadProfiler, 'profilePayloadLengths')
    const original = Object.assign(new Error(`secret stack ${canary.slice(0, 40)}`), {
      code: 'SQLITE_TOOBIG'
    })

    let thrown: unknown
    try {
      probe.diagnosedWrite(migrationRun, descriptor, rows, () => {
        throw original
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(original)
    expect(profileSpy).toHaveBeenCalledOnce()
    expect(profileSpy).toHaveBeenCalledWith(rows, descriptor)
    expect(recordEvent).toHaveBeenCalledOnce()
    expect(recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'execute',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0,
      migratorId: 'probe',
      payloadProfile: expect.objectContaining({
        target: 'message',
        rowCountBucket: '1',
        slots: [expect.objectContaining({ slot: 'content', kind: 'string' })]
      })
    })
    const serialized = JSON.stringify(recordEvent.mock.calls)
    expect(serialized).not.toContain('PRIVATE_MESSAGE_CANARY')
    expect(serialized).not.toContain('secret stack')
  })

  it('keeps the migration error authoritative when the diagnostics sink fails', () => {
    const diagnosticsFailure = new Error('journal unavailable')
    const migrationRun = createMigrationRun(
      vi.fn(() => {
        throw diagnosticsFailure
      })
    )
    const original = Object.assign(new Error('original private database error'), { code: 'SQLITE_TOOBIG' })

    expect(() =>
      probe.diagnosedWrite(migrationRun, descriptor, [{ content: 'PRIVATE_VALUE' }], () => {
        throw original
      })
    ).toThrow(original)
    expect(migrationRun.logger.error).toHaveBeenCalledWith('Failed to record bounded migration write diagnostics')
  })

  it('does not call the lazy async payload producer when the write succeeds', async () => {
    const migrationRun = createMigrationRun()
    const rows = vi.fn(() => [{ content: 'private-value' }])
    const result = { inserted: 1 }

    await expect(probe.diagnosedAsyncWrite(migrationRun, descriptor, rows, async () => result)).resolves.toBe(result)
    expect(rows).not.toHaveBeenCalled()
    expect(migrationRun.diagnostics.recordEvent).not.toHaveBeenCalled()
    expect(migrationRun.db.transaction).not.toHaveBeenCalled()
  })

  it('profiles the lazy async payload only after rejection and rethrows the original object', async () => {
    const recordEvent = vi.fn()
    const migrationRun = createMigrationRun(recordEvent)
    const rows = vi.fn(() => [{ content: 'PRIVATE_ASYNC_VALUE' }])
    const original = Object.assign(new Error('PRIVATE_ASYNC_ERROR'), { code: 'SQLITE_TOOBIG' })

    await expect(
      probe.diagnosedAsyncWrite(migrationRun, descriptor, rows, async () => {
        throw original
      })
    ).rejects.toBe(original)

    expect(rows).toHaveBeenCalledOnce()
    expect(recordEvent).toHaveBeenCalledOnce()
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'migrator',
        phase: 'execute',
        state: 'failed',
        category: 'database_write',
        code: 'sqlite_too_big',
        migratorId: 'probe',
        payloadProfile: expect.objectContaining({ target: 'message' })
      })
    )
    expect(JSON.stringify(recordEvent.mock.calls)).not.toContain('PRIVATE_ASYNC')
  })

  it('keeps an async write rejection authoritative when its lazy payload producer fails', async () => {
    const migrationRun = createMigrationRun()
    const original = Object.assign(new Error('original private async database error'), { code: 'SQLITE_TOOBIG' })

    await expect(
      probe.diagnosedAsyncWrite(
        migrationRun,
        descriptor,
        () => {
          throw new Error('measurement failed')
        },
        async () => {
          throw original
        }
      )
    ).rejects.toBe(original)
    expect(migrationRun.logger.error).toHaveBeenCalledWith('Failed to record bounded migration write diagnostics')
  })

  it('keeps an async write rejection authoritative when a lazy row source throws', async () => {
    const migrationRun = createMigrationRun()
    const original = Object.assign(new Error('original private async database error'), { code: 'SQLITE_TOOBIG' })
    const rows = {
      length: 1,
      getRow() {
        throw new Error('row measurement failed')
      }
    }

    await expect(
      probe.diagnosedAsyncWrite(
        migrationRun,
        descriptor,
        () => rows,
        async () => {
          throw original
        }
      )
    ).rejects.toBe(original)
    expect(migrationRun.logger.error).toHaveBeenCalledWith('Failed to record bounded migration write diagnostics')
  })

  it('returns only the fixed write classification beside a failed execute result', async () => {
    const migrationRun = createMigrationRun()
    const migrator = new ExecuteCaptureProbeMigrator('failed')

    const diagnosed = await (
      migrator as unknown as {
        executeWithDiagnostics(ctx: MigrationContext): Promise<{
          result: ExecuteResult
          failureClassification?: { category: string; code: string; causeDepth: number }
        }>
      }
    ).executeWithDiagnostics(migrationRun)

    expect(diagnosed).toEqual({
      result: { success: false, processedCount: 0, error: 'diagnosed failure' },
      failureClassification: { category: 'database_write', code: 'sqlite_too_big', causeDepth: 0 }
    })
    expect(JSON.stringify(diagnosed)).not.toContain('private diagnosed failure')
    expect(JSON.stringify(diagnosed)).not.toContain('PRIVATE_VALUE')
  })

  it('drops a swallowed best-effort classification when execute succeeds', async () => {
    const migrationRun = createMigrationRun()
    const migrator = new ExecuteCaptureProbeMigrator('best_effort_success')

    const diagnosed = await (migrator as any).executeWithDiagnostics(migrationRun)

    expect(diagnosed).toEqual({ result: { success: true, processedCount: 1 } })
  })

  it('does not attribute a cleared best-effort classification to a later unrelated failure', async () => {
    const migrationRun = createMigrationRun()
    const migrator = new ExecuteCaptureProbeMigrator('best_effort_then_unrelated')

    const diagnosed = await (migrator as any).executeWithDiagnostics(migrationRun)

    expect(diagnosed).toEqual({ result: { success: false, processedCount: 0, error: 'unrelated failure' } })
  })
})

describe('BaseMigrator phase diagnostics wrappers', () => {
  const migrationRun = {
    diagnostics: { recordEvent: vi.fn() },
    logger: { error: vi.fn() }
  } as unknown as MigrationContext

  it('returns only the fixed classification for caught prepare and validate failures', async () => {
    const migrator = new PhaseCaptureProbeMigrator()
    migrator.prepareOutcomes = ['captured_failure']
    migrator.validateOutcomes = ['captured_failure']

    const prepare = await (migrator as any).prepareWithDiagnostics(migrationRun)
    const validate = await (migrator as any).validateWithDiagnostics(migrationRun)

    expect(prepare).toEqual({
      result: { success: false, itemCount: 0, error: 'prepare failed' },
      failureClassification: { category: 'database_write', code: 'sqlite_too_big', causeDepth: 0 }
    })
    expect(validate).toEqual({
      result: {
        success: false,
        errors: [{ key: 'validation', message: 'validate failed' }],
        stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
      },
      failureClassification: { category: 'database_read', code: 'sqlite_corrupt', causeDepth: 0 }
    })
    expect(JSON.stringify({ prepare, validate })).not.toContain('PRIVATE_')
  })

  it('does not carry a prepare classification into a later validate phase', async () => {
    const migrator = new PhaseCaptureProbeMigrator()
    migrator.prepareOutcomes = ['captured_failure']
    migrator.validateOutcomes = ['plain_failure']

    await (migrator as any).prepareWithDiagnostics(migrationRun)
    const validate = await (migrator as any).validateWithDiagnostics(migrationRun)

    expect(validate).not.toHaveProperty('failureClassification')
  })

  it('clears a failed attempt before a successful retry', async () => {
    const migrator = new PhaseCaptureProbeMigrator()
    migrator.prepareOutcomes = ['captured_failure', 'success']

    const first = await (migrator as any).prepareWithDiagnostics(migrationRun)
    const retry = await (migrator as any).prepareWithDiagnostics(migrationRun)

    expect(first).toHaveProperty('failureClassification.code', 'sqlite_too_big')
    expect(retry).toEqual({ result: { success: true, itemCount: 0 } })
  })

  it('drops a captured best-effort error when the phase succeeds', async () => {
    const migrator = new PhaseCaptureProbeMigrator()
    migrator.prepareOutcomes = ['captured_success', 'plain_failure']

    const bestEffort = await (migrator as any).prepareWithDiagnostics(migrationRun)
    const laterFailure = await (migrator as any).prepareWithDiagnostics(migrationRun)

    expect(bestEffort).toEqual({ result: { success: true, itemCount: 0 } })
    expect(laterFailure).not.toHaveProperty('failureClassification')
  })
})
