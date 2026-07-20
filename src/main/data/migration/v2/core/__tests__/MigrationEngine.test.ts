import { miniAppLogoFileRefTable, providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../tests/__mocks__/MainLoggerService'
import { KnowledgeMigrator } from '../../migrators/KnowledgeMigrator'
import { McpServerMigrator } from '../../migrators/McpServerMigrator'
import { NoteMigrator } from '../../migrators/NoteMigrator'
import { PromptMigrator } from '../../migrators/PromptMigrator'
import { createMigrationContext } from '../MigrationContext'
import { MigrationDbService } from '../MigrationDbService'
import { MigrationEngine } from '../MigrationEngine'
import type { MigrationPaths } from '../MigrationPaths'

vi.mock('../MigrationContext', () => ({
  createMigrationContext: vi.fn().mockResolvedValue({})
}))

// Let initialize() run without opening a real SQLite file: a bare fake DB whose
// migration-status read returns no row (so needsMigration hits the fresh-install
// branch we want to exercise).
vi.mock('../MigrationDbService', () => ({
  MigrationDbService: {
    create: vi.fn(() => ({
      getDb: () => ({
        select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) })
      }),
      close: () => {}
    }))
  }
}))

const mockPaths: MigrationPaths = {
  userData: '/tmp/test-userdata',
  cherryHome: '/tmp/test-cherryhome',
  databaseFile: '/tmp/test-userdata/cherrystudio.sqlite',
  knowledgeBaseDir: '/tmp/test-userdata/Data/KnowledgeBase',
  filesDataDir: '/tmp/test-userdata/Data/Files',
  versionLogFile: '/tmp/test-userdata/version.log',
  legacyAgentDbFile: '/tmp/test-userdata/Data/agents.db',
  agentWorkspacesDir: '/tmp/test-userdata/Data/AgentWorkspaces',
  customMiniAppsFile: '/tmp/test-userdata/Data/Files/custom-minapps.json',
  diagnosticsJournalFile: '/tmp/test-userdata/migration-diagnostics-v1.json',
  legacyConfigFile: '/tmp/test-cherryhome/config/config.json',
  migrationsFolder: '/tmp/test-migrations'
}

function createTestMigrator(id: string, order: number, events: string[]) {
  const prepare = vi.fn(async () => {
    events.push(`${id}:prepare`)
    return { success: true, itemCount: 0 }
  })
  const execute = vi.fn(async () => {
    events.push(`${id}:execute`)
    return { success: true, processedCount: 0 }
  })
  const validate = vi.fn(async () => {
    events.push(`${id}:validate`)
    return {
      success: true,
      errors: [],
      stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
    }
  })
  return {
    id,
    name: id,
    description: `${id} migrator`,
    order,
    setProgressCallback: vi.fn(),
    reset: vi.fn(() => {
      events.push(`${id}:reset`)
    }),
    prepare,
    prepareWithDiagnostics: vi.fn(async () => ({ result: await prepare() })),
    execute,
    executeWithDiagnostics: vi.fn(async () => ({ result: await execute() })),
    validate,
    validateWithDiagnostics: vi.fn(async () => ({ result: await validate() }))
  }
}

describe('MigrationEngine', () => {
  let engine: MigrationEngine
  let diagnostics: {
    recordEvent: ReturnType<typeof vi.fn>
    finishAttempt: ReturnType<typeof vi.fn>
    complete: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    engine = new MigrationEngine()
    diagnostics = {
      recordEvent: vi.fn(),
      finishAttempt: vi.fn(),
      complete: vi.fn()
    }
    vi.mocked(createMigrationContext).mockResolvedValue({} as never)

    engine.initialize(mockPaths, false, diagnostics as any)

    ;(engine as any)._paths = mockPaths
    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => ({})),
      close: vi.fn()
    }

    vi.spyOn(engine as any, 'verifyAndClearNewTables').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'verifyForeignKeys').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'markCompleted').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'markFailed').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'cleanupTempFiles').mockResolvedValue(undefined)
  })

  it('collects full database diagnostics only inside the MigrationDbService callback lease', async () => {
    const lease = { opaque: true }
    const expected = { completion: { status: 'completed' } }
    const databaseDiagnostics = {
      inspect: vi.fn(),
      inspectWithLease: vi.fn(async (received) => {
        expect(received).toBe(lease)
        return expected
      })
    }
    const migrationDb = {
      getDb: vi.fn(() => ({})),
      close: vi.fn(),
      withDiagnosticsLease: vi.fn(async (run) => ({ kind: 'leased', value: await run(lease) }))
    }
    ;(engine as any).migrationDb = migrationDb

    await expect(engine.collectDatabaseDiagnostics(databaseDiagnostics as any)).resolves.toBe(expected)
    expect(migrationDb.withDiagnosticsLease).toHaveBeenCalledOnce()
    expect(databaseDiagnostics.inspectWithLease).toHaveBeenCalledExactlyOnceWith(lease)
    expect(databaseDiagnostics.inspect).not.toHaveBeenCalled()
  })

  it('falls back to L0-only diagnostics when a lease is unavailable or the engine is closed', async () => {
    const l0Only = { completion: { status: 'failed', code: 'lease_unavailable' } }
    const databaseDiagnostics = {
      inspect: vi.fn(async () => l0Only),
      inspectWithLease: vi.fn()
    }
    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => ({})),
      close: vi.fn(),
      withDiagnosticsLease: vi.fn(async () => ({ kind: 'unavailable' }))
    }

    await expect(engine.collectDatabaseDiagnostics(databaseDiagnostics as any)).resolves.toBe(l0Only)
    expect(databaseDiagnostics.inspect).toHaveBeenLastCalledWith(mockPaths.databaseFile)
    expect(databaseDiagnostics.inspectWithLease).not.toHaveBeenCalled()

    engine.close()
    await expect(engine.collectDatabaseDiagnostics(databaseDiagnostics as any)).resolves.toBe(l0Only)
    expect(databaseDiagnostics.inspect).toHaveBeenLastCalledWith(mockPaths.databaseFile)
  })

  it('resets every migrator before each run starts', async () => {
    const events: string[] = []
    const boot = createTestMigrator('boot', 1, events)
    const chat = createTestMigrator('chat', 2, events)

    engine.registerMigrators([chat as any, boot as any])

    await engine.run({}, '/tmp/dexie_export', '/tmp/localstorage_export/export.json')
    await engine.run({}, '/tmp/dexie_export', '/tmp/localstorage_export/export.json')

    expect(boot.reset).toHaveBeenCalledTimes(2)
    expect(chat.reset).toHaveBeenCalledTimes(2)
    expect(events).toStrictEqual([
      'boot:reset',
      'chat:reset',
      'boot:prepare',
      'boot:execute',
      'boot:validate',
      'chat:prepare',
      'chat:execute',
      'chat:validate',
      'boot:reset',
      'chat:reset',
      'boot:prepare',
      'boot:execute',
      'boot:validate',
      'chat:prepare',
      'chat:execute',
      'chat:validate'
    ])
  })

  it('aggregates prepare and execute warnings into the migrator result on success', async () => {
    const events: string[] = []
    const migrator = createTestMigrator('knowledge', 1, events)
    migrator.prepare.mockResolvedValueOnce({ success: true, itemCount: 0, warnings: ['prepare warn'] } as any)
    migrator.execute.mockResolvedValueOnce({ success: true, processedCount: 0, warnings: ['execute warn'] } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(true)
    expect(result.migratorResults).toHaveLength(1)
    expect(result.migratorResults[0].warnings).toEqual(['prepare warn', 'execute warn'])
  })

  it('omits the warnings field when a migrator reports none', async () => {
    const events: string[] = []
    const migrator = createTestMigrator('clean', 1, events)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.migratorResults[0].warnings).toBeUndefined()
  })

  it('logs failed runs with an Error object so stack/cause are preserved', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const failing = createTestMigrator('failing', 1, events)
    failing.execute.mockResolvedValueOnce({ success: false, processedCount: 0, error: 'execute exploded' } as any)

    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('Migration failed', expect.any(Error))
    const lastCall = errorSpy.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect((lastCall![1] as Error).message).toContain('execute exploded')

    errorSpy.mockRestore()
  })

  it('records a classified phase failure before status persistence and the attempt terminal event', async () => {
    const order: string[] = []
    diagnostics.recordEvent.mockImplementation((event) => {
      order.push(`${event.scope}:${event.phase}:${event.state}`)
    })
    diagnostics.finishAttempt.mockImplementation(() => order.push('attempt:failed'))
    vi.mocked((engine as any).markFailed).mockImplementation(async () => {
      order.push('status:failed')
    })
    const events: string[] = []
    const failing = createTestMigrator('chat', 1, events)
    const canary = 'PRIVATE_MESSAGE_CANARY_/Users/alice/sk-secret'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_TOOBIG' })
    failing.execute.mockRejectedValueOnce(original)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: canary })
    const executeStarted = order.indexOf('migrator:execute:started')
    const executeFailed = order.indexOf('migrator:execute:failed')
    const statusFailed = order.indexOf('status:failed')
    const terminal = order.indexOf('attempt:failed')
    expect(executeStarted).toBeGreaterThanOrEqual(0)
    expect(executeStarted).toBeLessThan(executeFailed)
    expect(executeFailed).toBeLessThan(statusFailed)
    expect(statusFailed).toBeLessThan(terminal)
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'execute',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0,
      migratorId: 'chat'
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0
    })
    expect(JSON.stringify(diagnostics.recordEvent.mock.calls)).not.toContain(canary)
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('preserves a diagnosed classification when a migrator returns a failed execute result', async () => {
    const events: string[] = []
    const failing = createTestMigrator('preferences', 1, events)
    failing.executeWithDiagnostics.mockResolvedValueOnce({
      result: { success: false, processedCount: 0, error: 'private display error' },
      failureClassification: { category: 'database_write', code: 'sqlite_too_big', causeDepth: 0 }
    } as never)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'preferences execute failed: private display error' })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'execute',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0,
      migratorId: 'preferences'
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0
    })
  })

  it('preserves a real COMMIT-boundary failure in the execute phase and terminal event', async () => {
    const canary = 'PRIVATE_COMMIT_CANARY_/Users/alice/cherrystudio.sqlite'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_TOOBIG' })
    const run = vi.fn()
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({ run }))
        }))
      }))
    }
    const context = {
      sources: {
        reduxState: {
          getCategory: vi.fn(() => ({
            notesPath: '/notes',
            starredPaths: ['/notes/a.md'],
            expandedPaths: []
          }))
        }
      },
      db: {
        transaction: vi.fn((operation: (tx: unknown) => void) => {
          operation(tx)
          throw original
        })
      },
      diagnostics,
      logger: { error: vi.fn() }
    }
    vi.mocked(createMigrationContext).mockResolvedValueOnce(context as never)
    engine.registerMigrators([new NoteMigrator()])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(canary) })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'execute',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0,
      migratorId: 'note'
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0
    })
    const serializedDiagnostics = JSON.stringify({
      events: diagnostics.recordEvent.mock.calls,
      terminal: diagnostics.finishAttempt.mock.calls
    })
    expect(serializedDiagnostics).not.toContain(canary)
  })

  it('preserves a real prepare exception classification after the migrator converts it to a failed result', async () => {
    const canary = 'PRIVATE_PREPARE_CANARY_/Users/alice/sk-secret'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_TOOBIG' })
    vi.mocked(createMigrationContext).mockResolvedValueOnce({
      sources: {
        dexieExport: {
          tableExists: vi.fn().mockRejectedValue(original)
        }
      }
    } as never)
    engine.registerMigrators([new PromptMigrator()])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: expect.stringContaining(canary) })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'prepare',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0,
      migratorId: 'prompt'
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0
    })
    expect(JSON.stringify(diagnostics.recordEvent.mock.calls)).not.toContain(canary)
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('preserves a real validate SQLITE_CORRUPT classification when markFailed also throws', async () => {
    const canary = 'PRIVATE_VALIDATE_CANARY_/Users/alice/messages'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_CORRUPT' })
    const statusError = Object.assign(new Error('PRIVATE_STATUS_CANARY'), { code: 'ENOSPC' })
    const migrator = new McpServerMigrator()
    vi.spyOn(migrator, 'prepare').mockResolvedValue({ success: true, itemCount: 0 })
    vi.spyOn(migrator, 'execute').mockResolvedValue({ success: true, processedCount: 0 })
    vi.mocked(createMigrationContext).mockResolvedValueOnce({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => {
            throw original
          })
        }))
      }
    } as never)
    vi.mocked((engine as any).markFailed).mockRejectedValueOnce(statusError)
    engine.registerMigrators([migrator])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: expect.stringContaining(canary) })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'validate',
      state: 'failed',
      category: 'database_read',
      code: 'sqlite_corrupt',
      causeDepth: 0,
      migratorId: 'mcp_server'
    })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'database',
      phase: 'finalize',
      state: 'failed',
      category: 'filesystem',
      code: 'disk_full',
      causeDepth: 0
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_read',
      code: 'sqlite_corrupt',
      causeDepth: 0
    })
    expect(JSON.stringify(diagnostics.recordEvent.mock.calls)).not.toContain(canary)
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('profiles the real resurrected user_model write and preserves its terminal classification', async () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0)
    const nameCanary = `PRIVATE_MODEL_NAME_${'n'.repeat(300)}`
    const groupCanary = `PRIVATE_MODEL_GROUP_${'g'.repeat(5_000)}`
    const original = Object.assign(new Error(`SQLITE_TOOBIG ${nameCanary} ${groupCanary}`), {
      code: 'SQLITE_TOOBIG'
    })
    const boundaryAll = vi.fn().mockReturnValue([])
    const insertAll = vi.fn(() => {
      throw original
    })
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({ all: boundaryAll }))
            }))
          }))
        }))
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => ({ all: insertAll }))
        }))
      }))
    }
    const context = {
      db: {
        transaction: vi.fn((operation: (tx: unknown) => unknown) => operation(tx))
      },
      diagnostics,
      logger: { error: vi.fn() },
      sharedData: new Map()
    }
    vi.mocked(createMigrationContext).mockResolvedValueOnce(context as never)

    const migrator = new KnowledgeMigrator() as any
    const reset = migrator.reset.bind(migrator)
    vi.spyOn(migrator, 'reset').mockImplementation(() => {
      reset()
      migrator.preparedBases = [{ id: 'kb-diagnostic' }]
      migrator.resurrectedEmbeddingModels = new Map([
        [
          'private-provider::private-model',
          {
            id: 'private-provider::private-model',
            providerId: 'private-provider',
            modelId: 'private-model',
            name: nameCanary,
            group: groupCanary
          }
        ]
      ])
    })
    vi.spyOn(migrator, 'prepare').mockResolvedValue({ success: true, itemCount: 1 })
    engine.registerMigrators([migrator])

    const result = await engine.run({}, '/tmp/dexie_export')
    performanceNow.mockRestore()

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('SQLITE_TOOBIG') })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'migrator',
        phase: 'execute',
        state: 'failed',
        category: 'database_write',
        code: 'sqlite_too_big',
        causeDepth: 0,
        migratorId: 'knowledge',
        payloadProfile: expect.objectContaining({
          target: 'user_model',
          rowCountBucket: '1',
          slots: expect.arrayContaining([
            expect.objectContaining({
              slot: 'name',
              kind: 'string',
              maxCharLengthBucket: '257-4096'
            }),
            expect.objectContaining({
              slot: 'group',
              kind: 'string',
              maxCharLengthBucket: '4097-65536'
            })
          ])
        })
      })
    )
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith('failed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'failed',
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 0
    })
    const serializedDiagnostics = JSON.stringify({
      events: diagnostics.recordEvent.mock.calls,
      terminal: diagnostics.finishAttempt.mock.calls
    })
    expect(serializedDiagnostics).not.toContain(nameCanary)
    expect(serializedDiagnostics).not.toContain(groupCanary)
  })

  it('rethrows database initialization failures after recording fixed metadata even when the sink fails', () => {
    const original = Object.assign(new Error('PRIVATE_DATABASE_PATH_/Users/alice'), { code: 'SQLITE_CORRUPT' })
    vi.mocked(MigrationDbService.create).mockImplementationOnce(() => {
      throw original
    })
    const localDiagnostics = {
      recordEvent: vi.fn((event) => {
        if (event.state === 'failed') throw new Error('journal unavailable')
      }),
      finishAttempt: vi.fn(),
      complete: vi.fn()
    }
    const loggerError = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const localEngine = new MigrationEngine()

    expect(() => localEngine.initialize(mockPaths, false, localDiagnostics as any)).toThrow(original)
    expect(localDiagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'database',
      phase: 'initialize',
      state: 'failed',
      category: 'database_read',
      code: 'sqlite_corrupt',
      causeDepth: 0
    })
    expect(JSON.stringify(localDiagnostics.recordEvent.mock.calls)).not.toContain('PRIVATE_DATABASE_PATH')
    expect(loggerError).toHaveBeenCalledWith('Failed to record bounded migration diagnostic event')
  })

  it('records a status-write failure independently without replacing the original migration error', async () => {
    const order: string[] = []
    diagnostics.recordEvent.mockImplementation((event) => order.push(`${event.scope}:${event.phase}:${event.state}`))
    diagnostics.finishAttempt.mockImplementation(() => order.push('attempt:failed'))
    const statusError = Object.assign(new Error('PRIVATE_STATUS_PATH_/Users/alice'), { code: 'ENOSPC' })
    vi.mocked((engine as any).markFailed).mockImplementation(async () => {
      order.push('status:write')
      throw statusError
    })
    const events: string[] = []
    const failing = createTestMigrator('chat', 1, events)
    const original = Object.assign(new Error('PRIVATE_ORIGINAL'), { code: 'SQLITE_TOOBIG' })
    failing.execute.mockRejectedValueOnce(original)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'PRIVATE_ORIGINAL' })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'database',
      phase: 'finalize',
      state: 'failed',
      category: 'filesystem',
      code: 'disk_full',
      causeDepth: 0
    })
    expect(order.indexOf('status:write')).toBeLessThan(order.indexOf('database:finalize:failed'))
    expect(order.indexOf('database:finalize:failed')).toBeLessThan(order.indexOf('attempt:failed'))
    expect(JSON.stringify(diagnostics.recordEvent.mock.calls)).not.toContain('PRIVATE_STATUS_PATH')
  })

  it('clears diagnostics only after the completed status is persisted and the attempt is terminal', async () => {
    const order: string[] = []
    vi.mocked((engine as any).markCompleted).mockImplementation(async () => order.push('status:completed'))
    diagnostics.finishAttempt.mockImplementation(() => order.push('attempt:completed'))
    diagnostics.complete.mockImplementation(() => order.push('journal:cleanup'))
    const events: string[] = []
    engine.registerMigrators([createTestMigrator('chat', 1, events) as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(true)
    expect(order).toEqual(['status:completed', 'attempt:completed', 'journal:cleanup'])
  })

  it('keeps a diagnostics sink failure observable without changing the original terminal result', async () => {
    const loggerError = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    diagnostics.recordEvent.mockImplementation((event) => {
      if (event.state === 'failed') throw new Error('journal unavailable')
    })
    const events: string[] = []
    const failing = createTestMigrator('chat', 1, events)
    const original = Object.assign(new Error('PRIVATE_ORIGINAL'), { code: 'SQLITE_TOOBIG' })
    failing.execute.mockRejectedValueOnce(original)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'PRIVATE_ORIGINAL' })
    expect(diagnostics.finishAttempt).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith('Failed to record bounded migration diagnostic event')
  })

  it('classifies a table-clear failure with fixed metadata only', async () => {
    const canary = 'PRIVATE_CLEAR_SQL_DELETE_FROM_message_/Users/alice'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_CORRUPT' })
    vi.mocked((engine as any).verifyAndClearNewTables).mockImplementation(() => {
      throw original
    })

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: canary })
    expect(diagnostics.recordEvent).toHaveBeenCalledWith({
      scope: 'database',
      phase: 'initialize',
      state: 'failed',
      category: 'database_read',
      code: 'sqlite_corrupt',
      causeDepth: 0
    })
    expect(JSON.stringify(diagnostics.recordEvent.mock.calls)).not.toContain(canary)
  })

  it('aborts the whole migration when validate() reports targetCount below sourceCount minus skippedCount', async () => {
    // The engine reconciliation that KnowledgeVectorMigrator's per-base isolation (C1) depends on:
    // an uncredited shortfall (a base whose rows counted into sourceCount but produced no target
    // units and were NOT added to skippedCount) trips `targetCount < sourceCount - skippedCount`
    // and fails the whole migration.
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const migrator = createTestMigrator('knowledge_vector', 1, events)
    migrator.validate.mockResolvedValueOnce({
      success: true,
      errors: [],
      stats: { sourceCount: 2, targetCount: 1, skippedCount: 0 }
    } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(result.error).toContain('count mismatch')
    expect((engine as any).markFailed).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('accepts the run when skippedCount credits the shortfall (per-base failure isolation)', async () => {
    // The flip side: crediting the failed base's expected units to skippedCount (what C1 does in
    // the per-base catch) drops expectedCount in lockstep with the missing targetCount, so the same
    // 2-source / 1-target outcome reconciles and the migration succeeds instead of aborting.
    const events: string[] = []
    const migrator = createTestMigrator('knowledge_vector', 1, events)
    migrator.validate.mockResolvedValueOnce({
      success: true,
      errors: [],
      stats: { sourceCount: 2, targetCount: 1, skippedCount: 1 }
    } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(true)
    expect((engine as any).markFailed).not.toHaveBeenCalled()
  })

  describe('needsMigration — legacyDataConfirmed flag', () => {
    it('returns true without markCompleted when legacyDataConfirmed is true (no status row)', async () => {
      const freshEngine = new MigrationEngine()
      freshEngine.initialize(mockPaths, true)
      // Isolate the flag: without the OR, an empty electron-store would markCompleted+false.
      vi.spyOn(freshEngine as any, 'hasLegacyData').mockReturnValue(false)
      const markSpy = vi.spyOn(freshEngine as any, 'markCompleted').mockResolvedValue(undefined)

      expect(await freshEngine.needsMigration()).toBe(true)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('markCompleted + returns false when not legacyDataConfirmed and no legacy data', async () => {
      const freshEngine = new MigrationEngine()
      freshEngine.initialize(mockPaths, false)
      vi.spyOn(freshEngine as any, 'hasLegacyData').mockReturnValue(false)
      const markSpy = vi.spyOn(freshEngine as any, 'markCompleted').mockResolvedValue(undefined)

      expect(await freshEngine.needsMigration()).toBe(false)
      expect(markSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('clears new architecture tables inside one transaction', async () => {
    const runFn = vi.fn()
    const deleteFn = vi.fn(() => ({ run: runFn }))
    const transactionFn = vi.fn((fn: (tx: unknown) => void) => {
      fn({ delete: deleteFn })
    })
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          get: vi.fn(() => ({ count: 0 }))
        }))
      })),
      transaction: transactionFn
    }
    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => db),
      close: vi.fn()
    }
    vi.mocked((engine as any).verifyAndClearNewTables).mockRestore()

    await (engine as any).verifyAndClearNewTables()

    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(deleteFn).toHaveBeenCalledTimes(db.select.mock.calls.length)
    expect(db).not.toHaveProperty('delete')
  })

  it('includes the provider/mini-app logo ref tables in the clear set (retry safety)', async () => {
    // Migration runs with foreign_keys OFF, so clearing owner / file_entry rows does
    // NOT cascade to the logo ref rows — they must be cleared explicitly, else a
    // retry collides with the unique (source_id) index and can never recover.
    const deletedTables: unknown[] = []
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ get: vi.fn(() => ({ count: 0 })) })) })),
      transaction: vi.fn((fn: (tx: unknown) => void) =>
        fn({
          delete: (table: unknown) => {
            deletedTables.push(table)
            return { run: vi.fn() }
          }
        })
      )
    }
    ;(engine as any).migrationDb = { getDb: vi.fn(() => db), close: vi.fn() }
    vi.mocked((engine as any).verifyAndClearNewTables).mockRestore()

    await (engine as any).verifyAndClearNewTables()

    expect(deletedTables).toContain(providerLogoFileRefTable)
    expect(deletedTables).toContain(miniAppLogoFileRefTable)
  })
})
