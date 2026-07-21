import { agentSessionTable } from '@data/db/schemas/agentSession'
import { miniAppLogoFileRefTable, providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../tests/__mocks__/MainLoggerService'
import { BaseMigrator } from '../../migrators/BaseMigrator'
import { KnowledgeMigrator } from '../../migrators/KnowledgeMigrator'
import { McpServerMigrator } from '../../migrators/McpServerMigrator'
import { NoteMigrator } from '../../migrators/NoteMigrator'
import { PromptMigrator } from '../../migrators/PromptMigrator'
import { createMigrationContext, type MigrationContext } from '../MigrationContext'
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
  diagnosticsJournalFile: '/tmp/test-userdata/migration-diagnostics-v2.json',
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
    updateLocation: ReturnType<typeof vi.fn>
    finishAttempt: ReturnType<typeof vi.fn>
    complete: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    engine = new MigrationEngine()
    diagnostics = {
      updateLocation: vi.fn(),
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
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({ status: 'completed' })
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

  it('records one terminal phase failure before secondary status persistence', async () => {
    const order: string[] = []
    diagnostics.updateLocation.mockImplementation((location) => {
      order.push(`${location.scope}:${location.phase}`)
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
    const executeLocation = order.indexOf('migrator:execute')
    const statusFailed = order.indexOf('status:failed')
    const terminal = order.indexOf('attempt:failed')
    expect(executeLocation).toBeGreaterThanOrEqual(0)
    expect(executeLocation).toBeLessThan(terminal)
    expect(terminal).toBeLessThan(statusFailed)
    expect(diagnostics.updateLocation).toHaveBeenCalledWith({
      scope: 'migrator',
      phase: 'execute',
      migratorId: 'chat'
    })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'chat',
        errorCode: 'sqlite_too_big'
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('preserves a diagnosed classification when a migrator returns a failed execute result', async () => {
    const events: string[] = []
    const failing = createTestMigrator('preferences', 1, events)
    failing.executeWithDiagnostics.mockResolvedValueOnce({
      result: { success: false, processedCount: 0, error: 'private display error' },
      failure: { classification: { errorCode: 'sqlite_too_big' } }
    } as never)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'preferences execute failed: private display error' })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'preferences',
        errorCode: 'sqlite_too_big'
      }
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
      logger: { error: vi.fn() }
    }
    vi.mocked(createMigrationContext).mockResolvedValueOnce(context as never)
    engine.registerMigrators([new NoteMigrator()])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(canary) })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'note',
        errorCode: 'sqlite_too_big'
      }
    })
    const serializedDiagnostics = JSON.stringify(diagnostics.finishAttempt.mock.calls)
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
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'source_prepare_failed',
        scope: 'migrator',
        phase: 'prepare',
        migratorId: 'prompt',
        errorCode: 'sqlite_too_big'
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('classifies a migration-context JSON parse failure at the real engine prepare boundary', async () => {
    const canary = 'PRIVATE_SETTINGS_JSON_/Users/alice'
    vi.mocked(createMigrationContext).mockRejectedValueOnce(new SyntaxError(canary))

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: canary })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'source_prepare_failed',
        scope: 'engine',
        phase: 'prepare',
        errorCode: 'source_parse_failed'
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
  })

  it('preserves the real MCP all-required-source-id failure evidence', async () => {
    vi.mocked(createMigrationContext).mockResolvedValueOnce({
      sources: {
        reduxState: {
          get: vi.fn(() => [
            { name: 'missing-id-one', isActive: true },
            { name: 'missing-id-two', isActive: false }
          ])
        }
      }
    } as never)
    engine.registerMigrators([new McpServerMigrator()])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('MCP Server prepare failed') })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'source_prepare_failed',
        scope: 'migrator',
        phase: 'prepare',
        migratorId: 'mcp_server',
        errorCode: 'source_required_records_rejected',
        evidence: {
          kind: 'all_required_rows_rejected',
          sourceRole: 'mcp_server',
          fieldRole: 'source_id',
          rejectedCountBucket: '2-10'
        }
      }
    })
  })

  it('preserves a real resurrected user_model failure without measuring names', async () => {
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

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('SQLITE_TOOBIG') })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'knowledge',
        errorCode: 'sqlite_too_big'
      }
    })
    const serializedDiagnostics = JSON.stringify(diagnostics.finishAttempt.mock.calls)
    expect(serializedDiagnostics).not.toContain(nameCanary)
    expect(serializedDiagnostics).not.toContain(groupCanary)
  })

  it('rethrows database initialization failures after recording fixed metadata even when the sink fails', () => {
    const original = Object.assign(new Error('PRIVATE_DATABASE_PATH_/Users/alice'), { code: 'SQLITE_CORRUPT' })
    vi.mocked(MigrationDbService.create).mockImplementationOnce(() => {
      throw original
    })
    const localDiagnostics = {
      updateLocation: vi.fn(() => {
        throw new Error('journal unavailable')
      }),
      finishAttempt: vi.fn(() => {
        throw new Error('journal unavailable')
      }),
      complete: vi.fn()
    }
    const loggerError = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const localEngine = new MigrationEngine()

    expect(() => localEngine.initialize(mockPaths, false, localDiagnostics as any)).toThrow(original)
    expect(localDiagnostics.updateLocation).toHaveBeenCalledWith({ scope: 'database', phase: 'initialize' })
    expect(localDiagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'preboot_failed',
        scope: 'database',
        phase: 'initialize',
        errorCode: 'sqlite_corrupt'
      }
    })
    expect(JSON.stringify(localDiagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_DATABASE_PATH')
    expect(loggerError).toHaveBeenCalledWith('Failed to update bounded migration diagnostic location')
    expect(loggerError).toHaveBeenCalledWith('Failed to record bounded migration diagnostic terminal result')
  })

  it('records the original root before preserving a status-write rejection', async () => {
    const order: string[] = []
    diagnostics.updateLocation.mockImplementation((location) => order.push(`${location.scope}:${location.phase}`))
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

    await expect(engine.run({}, '/tmp/dexie_export')).rejects.toBe(statusError)

    expect(diagnostics.finishAttempt).toHaveBeenCalledTimes(1)
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'chat',
        errorCode: 'sqlite_too_big'
      }
    })
    expect(order.indexOf('attempt:failed')).toBeLessThan(order.indexOf('status:write'))
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_STATUS_PATH')
  })

  it('records the final foreign-key check as a validation failure', async () => {
    const error = Object.assign(new Error('PRIVATE_FK_SAMPLE'), { code: 'MIGRATION_FOREIGN_KEY' })
    vi.mocked((engine as any).verifyForeignKeys).mockImplementation(() => {
      throw error
    })

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_validation_failed',
        scope: 'database',
        phase: 'validate',
        errorCode: 'validation_foreign_key',
        evidence: { kind: 'validation', checkRole: 'foreign_key' }
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_FK_SAMPLE')
  })

  it('records a completed-status write failure at the finalization boundary', async () => {
    const error = Object.assign(new Error('PRIVATE_STATUS_PATH'), { code: 'ENOSPC' })
    vi.mocked((engine as any).markCompleted).mockRejectedValueOnce(error)

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_finalize_failed',
        scope: 'database',
        phase: 'finalize',
        errorCode: 'file_io'
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_STATUS_PATH')
  })

  it('maps an Agents owned-table FK failure to one invariant outcome', async () => {
    const events: string[] = []
    const failing = createTestMigrator('agents', 1, events)
    failing.executeWithDiagnostics.mockResolvedValueOnce({
      result: { success: false, processedCount: 0, error: 'PRIVATE_FK_DISPLAY' },
      failure: {
        classification: { errorCode: 'validation_foreign_key' },
        evidence: { kind: 'invariant', invariantRole: 'foreign_key' }
      }
    } as never)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(diagnostics.finishAttempt).toHaveBeenCalledTimes(1)
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_invariant_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'agents',
        errorCode: 'validation_foreign_key',
        evidence: { kind: 'invariant', invariantRole: 'foreign_key' }
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_FK_DISPLAY')
  })

  it('maps a thrown owned-table FK self-check through the real migrator wrapper', async () => {
    class ThrowingForeignKeyMigrator extends BaseMigrator {
      readonly id = 'agents'
      readonly name = 'Agents'
      readonly description = 'test owned-table validation'
      readonly order = 1

      reset(): void {}

      async prepare() {
        return { success: true, itemCount: 1 }
      }

      async execute(ctx: MigrationContext) {
        this.assertOwnedForeignKeys(ctx.db, [agentSessionTable])
        return { success: true, processedCount: 1 }
      }

      async validate() {
        return { success: true, errors: [], stats: { sourceCount: 1, targetCount: 1, skippedCount: 0 } }
      }
    }

    vi.mocked(createMigrationContext).mockResolvedValue({
      db: {
        all: vi.fn(() => [{ table: 'agent_session', rowid: 1, parent: 'PRIVATE_PARENT_TABLE', fkid: 0 }])
      }
    } as never)
    engine.registerMigrators([new ThrowingForeignKeyMigrator()])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(diagnostics.finishAttempt).toHaveBeenCalledTimes(1)
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_invariant_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'agents',
        errorCode: 'validation_foreign_key',
        evidence: { kind: 'invariant', invariantRole: 'foreign_key' }
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain('PRIVATE_PARENT_TABLE')
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

  it('clears diagnostics after a skipped migration is persisted and the attempt is terminal', async () => {
    const order: string[] = []
    vi.mocked((engine as any).markCompleted).mockImplementation(async () => order.push('status:completed'))
    diagnostics.finishAttempt.mockImplementation(() => order.push('attempt:completed'))
    diagnostics.complete.mockImplementation(() => order.push('journal:cleanup'))

    await engine.skipMigration()

    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({ status: 'completed' })
    expect(order).toEqual(['status:completed', 'attempt:completed', 'journal:cleanup'])
  })

  it('keeps a diagnostics sink failure observable without changing the original terminal result', async () => {
    const loggerError = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    diagnostics.finishAttempt.mockImplementation(() => {
      throw new Error('journal unavailable')
    })
    const events: string[] = []
    const failing = createTestMigrator('chat', 1, events)
    const original = Object.assign(new Error('PRIVATE_ORIGINAL'), { code: 'SQLITE_TOOBIG' })
    failing.execute.mockRejectedValueOnce(original)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'PRIVATE_ORIGINAL' })
    expect(diagnostics.finishAttempt).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledWith('Failed to record bounded migration diagnostic terminal result')
  })

  it('classifies a table-clear failure with fixed metadata only', async () => {
    const canary = 'PRIVATE_CLEAR_SQL_DELETE_FROM_message_/Users/alice'
    const original = Object.assign(new Error(canary), { code: 'SQLITE_CORRUPT' })
    vi.mocked((engine as any).verifyAndClearNewTables).mockImplementation(() => {
      throw original
    })

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: canary })
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_write_failed',
        scope: 'database',
        phase: 'execute',
        errorCode: 'sqlite_corrupt'
      }
    })
    expect(JSON.stringify(diagnostics.finishAttempt.mock.calls)).not.toContain(canary)
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
    expect(diagnostics.finishAttempt).toHaveBeenCalledWith({
      status: 'failed',
      failure: {
        kind: 'migration_validation_failed',
        scope: 'migrator',
        phase: 'validate',
        migratorId: 'knowledge_vector',
        errorCode: 'validation_count_mismatch',
        evidence: {
          kind: 'validation',
          checkRole: 'count',
          expectedCountBucket: '2-10',
          actualCountBucket: '1'
        }
      }
    })

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
