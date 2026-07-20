import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationDbService } from '../../core/MigrationDbService'
import { MigrationEngine } from '../../core/MigrationEngine'
import type { MigrationPaths } from '../../core/MigrationPaths'
import {
  MigrationDatabaseDiagnostics,
  type MigrationDatabaseDiagnosticsChildFactory,
  type MigrationDatabaseDiagnosticsChildLike
} from '../MigrationDatabaseDiagnostics'
import type {
  MigrationDatabaseCompletedDiagnosticResult,
  MigrationDatabaseDiagnosticStep
} from '../migrationDatabaseDiagnosticsSchemas'

function createPaths(root: string): MigrationPaths {
  return {
    userData: root,
    cherryHome: root,
    databaseFile: join(root, 'cherrystudio.sqlite'),
    knowledgeBaseDir: join(root, 'Data', 'KnowledgeBase'),
    filesDataDir: join(root, 'Data', 'Files'),
    versionLogFile: join(root, 'version.log'),
    legacyAgentDbFile: join(root, 'Data', 'agents.db'),
    agentWorkspacesDir: join(root, 'Data', 'Agents'),
    customMiniAppsFile: join(root, 'Data', 'Files', 'custom-minapps.json'),
    diagnosticsJournalFile: join(root, 'migration-diagnostics-v2.json'),
    legacyConfigFile: join(root, 'config.json'),
    migrationsFolder: join(process.cwd(), 'migrations', 'sqlite-drizzle')
  }
}

function identity(file: string): { readonly device: string; readonly inode: string } {
  const stats = lstatSync(file, { bigint: true })
  return { device: stats.dev.toString(), inode: stats.ino.toString() }
}

function expectRegular(file: string): void {
  expect(existsSync(file)).toBe(true)
  const stats = lstatSync(file)
  expect(stats.isFile()).toBe(true)
  expect(stats.isSymbolicLink()).toBe(false)
}

function makeCompletedResult(): MigrationDatabaseCompletedDiagnosticResult {
  const l0: Extract<MigrationDatabaseDiagnosticStep, { level: 'l0' }> = {
    level: 'l0',
    status: 'success',
    data: {
      exists: true,
      fileKind: 'regular',
      sizeBucket: '4_kib_to_1_mib',
      mtimeAgeBucket: 'under_1_hour',
      header: 'valid',
      writeMode: 'wal',
      walSidecars: 'complete'
    }
  }
  return {
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'completed' },
    l0,
    l1: { level: 'l1', status: 'failed', code: 'query_failed' },
    l2: { level: 'l2', status: 'failed', code: 'query_failed' }
  }
}

class PausedChild extends EventEmitter implements MigrationDatabaseDiagnosticsChildLike {
  readonly stderr = new EventEmitter()
  readonly sent: unknown[] = []
  readonly send = vi.fn((message: unknown, callback?: (error: Error | null) => void) => {
    this.sent.push(message)
    callback?.(null)
    return true
  })
  readonly kill = vi.fn(() => true)
  readonly unref = vi.fn()
}

describe('MigrationDatabaseDiagnostics isolated process integration', () => {
  let fixtureDir: string
  let service: MigrationDbService | undefined
  let engine: MigrationEngine | undefined

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'migration-db-process-'))
  })

  afterEach(() => {
    engine?.close()
    service?.close()
    engine = undefined
    service = undefined
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('holds the lease across an engine close after L0 and releases it only after child close', async () => {
    const paths = createPaths(fixtureDir)
    engine = new MigrationEngine()
    engine.initialize(paths)
    const children: PausedChild[] = []
    const createChild: MigrationDatabaseDiagnosticsChildFactory = () => {
      const child = new PausedChild()
      children.push(child)
      return child
    }
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = engine.collectDatabaseDiagnostics(diagnostics)
    const child = children[0]
    const result = makeCompletedResult()
    const walFile = `${paths.databaseFile}-wal`
    const shmFile = `${paths.databaseFile}-shm`

    child.emit('message', { type: 'ready', version: 1 })
    const input = child.sent[0] as any
    expect(input).toMatchObject({
      mode: 'full',
      databaseFile: paths.databaseFile,
      identity: {
        database: identity(paths.databaseFile),
        wal: identity(walFile),
        shm: identity(shmFile)
      }
    })
    child.emit('message', { type: 'step', step: result.l0 })

    engine.close()
    expectRegular(walFile)
    expectRegular(shmFile)
    expect(identity(walFile)).toEqual(input.identity.wal)
    expect(identity(shmFile)).toEqual(input.identity.shm)

    child.emit('message', { type: 'step', step: result.l1 })
    child.emit('message', { type: 'step', step: result.l2 })
    child.emit('message', { type: 'result', result })
    child.emit('close', 0, null)

    await expect(inspection).resolves.toEqual(result)
    expect(existsSync(walFile)).toBe(false)
    expect(existsSync(shmFile)).toBe(false)
  })

  it('bounds an asynchronous spawn failure, releases a deferred close, and cleans listeners', async () => {
    const paths = createPaths(fixtureDir)
    service = MigrationDbService.create(paths)
    service.getDb().run(sql`CREATE INDEX async_spawn_failure_idx ON preference(key)`)
    const walFile = `${paths.databaseFile}-wal`
    const shmFile = `${paths.databaseFile}-shm`
    expectRegular(walFile)
    expectRegular(shmFile)

    const missingExecutable = join(fixtureDir, 'private-spawn-canary-does-not-exist')
    const lifecycleEvents: string[] = []
    let spawnedChild: ChildProcess | undefined
    const createChild: MigrationDatabaseDiagnosticsChildFactory = (_modulePath, options) => {
      spawnedChild = spawn(missingExecutable, [], options)
      const handleUnexpectedExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        lifecycleEvents.push(`exit:${code}:${signal}`)
      }
      spawnedChild.once('error', (error: NodeJS.ErrnoException) => {
        lifecycleEvents.push(`error:${error.code}`)
      })
      spawnedChild.once('exit', handleUnexpectedExit)
      spawnedChild.once('close', (code, signal) => {
        spawnedChild?.removeListener('exit', handleUnexpectedExit)
        lifecycleEvents.push(`close:${code}:${signal}`)
      })
      return spawnedChild
    }
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 50 })
    const startedAt = Date.now()
    const inspection = service.withDiagnosticsLease((lease) => diagnostics.inspectWithLease(lease))
    const child = spawnedChild
    if (child === undefined) throw new Error('Expected the real child process to be created')

    service.close()
    expectRegular(walFile)
    expectRegular(shmFile)

    let bound: NodeJS.Timeout | undefined
    const outcome = await Promise.race([
      inspection.then((value) => ({ kind: 'settled' as const, value })),
      new Promise<{ readonly kind: 'hung' }>((resolve) => {
        bound = setTimeout(() => resolve({ kind: 'hung' }), 500)
        bound.unref()
      })
    ])
    if (bound !== undefined) clearTimeout(bound)

    expect(outcome.kind).toBe('settled')
    if (outcome.kind !== 'settled') return
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(outcome.value.kind).toBe('leased')
    if (outcome.value.kind !== 'leased') throw new Error('Expected a real diagnostics lease')
    expect(lifecycleEvents).toEqual(['error:ENOENT', 'close:-2:null'])
    expect(outcome.value.value.completion).toEqual({ status: 'failed', code: 'process_error' })
    expect(JSON.stringify(outcome.value.value)).not.toMatch(/ENOENT|private-spawn-canary|migration-db-process-/)
    expect(existsSync(walFile)).toBe(false)
    expect(existsSync(shmFile)).toBe(false)
    expect(child.listenerCount('message')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('close')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.stderr?.listenerCount('data')).toBe(0)
  })

  it('SIGKILLs a confirmed in-flight native SQLite query, waits for exit, and releases its WAL reader', async () => {
    const paths = createPaths(fixtureDir)
    service = MigrationDbService.create(paths)
    service.getDb().run(sql`CREATE INDEX native_kill_before_idx ON preference(key)`)

    let queryStartedAt = 0
    let exitedAt = 0
    let markQueryStarted!: () => void
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve
    })
    const fixtureChild = join(
      process.cwd(),
      'src/main/data/migration/v2/diagnostics/__tests__/fixtures/nativeSqliteHangChild.mjs'
    )
    const createChild: MigrationDatabaseDiagnosticsChildFactory = (_modulePath, options) => {
      const child = spawn(process.execPath, [fixtureChild], options)
      child.on('message', (message) => {
        if (
          message !== null &&
          typeof message === 'object' &&
          'type' in message &&
          message.type === 'step' &&
          'step' in message &&
          message.step !== null &&
          typeof message.step === 'object' &&
          'level' in message.step &&
          message.step.level === 'l1'
        ) {
          queryStartedAt = Date.now()
          markQueryStarted()
        }
      })
      child.once('exit', () => {
        exitedAt = Date.now()
      })
      return child
    }
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 750 })
    const inspection = service.withDiagnosticsLease((lease) => diagnostics.inspectWithLease(lease))

    await queryStarted
    const leased = await inspection
    expect(leased.kind).toBe('leased')
    if (leased.kind !== 'leased') throw new Error('Expected a real diagnostics lease')
    expect(leased.value.completion).toEqual({ status: 'timed_out', code: 'process_timeout' })
    expect(queryStartedAt).toBeGreaterThan(0)
    expect(exitedAt).toBeGreaterThanOrEqual(queryStartedAt)
    expect(exitedAt - queryStartedAt).toBeLessThan(3_000)

    expect(() => service?.getDb().run(sql`CREATE INDEX native_kill_after_idx ON preference(value)`)).not.toThrow()
    expect(() => service?.getDb().all(sql`PRAGMA wal_checkpoint(PASSIVE)`)).not.toThrow()
    expect(service.getDb().get<{ integrity_check: string }>(sql`PRAGMA integrity_check`)).toEqual({
      integrity_check: 'ok'
    })
  }, 10_000)
})
