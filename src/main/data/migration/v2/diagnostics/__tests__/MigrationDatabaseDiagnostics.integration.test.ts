import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../migrationDatabaseDiagnosticsWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(`${process.cwd()}/src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsWorker.ts`, {
      ...options,
      execArgv: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']
    })
}))

import { MigrationDatabaseDiagnostics } from '../MigrationDatabaseDiagnostics'
import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  type MigrationDatabaseCompletedDiagnosticResult,
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema,
  migrationDatabaseDiagnosticsWorkerMessageSchema
} from '../migrationDatabaseDiagnosticsSchemas'

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function fileFingerprint(file: string):
  | { readonly exists: false }
  | {
      readonly exists: true
      readonly regular: boolean
      readonly size: number
      readonly mtimeMs: number
      readonly hash: string
    } {
  if (!existsSync(file)) return { exists: false }
  const stats = lstatSync(file)
  return {
    exists: true,
    regular: stats.isFile() && !stats.isSymbolicLink(),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    hash: sha256(file)
  }
}

function sidecarState(file: string): Record<string, boolean> {
  return Object.fromEntries(['-wal', '-shm', '-journal'].map((suffix) => [suffix, existsSync(`${file}${suffix}`)]))
}

function expectCompleted(
  result: MigrationDatabaseDiagnosticResult
): asserts result is MigrationDatabaseCompletedDiagnosticResult {
  expect(result.completion.status).toBe('completed')
  if (result.completion.status !== 'completed') throw new Error('Expected the real worker to complete')
}

describe('MigrationDatabaseDiagnostics integration', () => {
  const dbh = setupTestDatabase()
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'migration-db-diagnostics-'))
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  function copyProductionDatabase(name: string): string {
    const destination = join(fixtureDir, name)
    copyFileSync(dbh.sqlite.name, destination)
    const fixture = new Database(destination)
    fixture.pragma('journal_mode = DELETE')
    fixture.close()
    return destination
  }

  it('inspects a healthy production database without changing it and closes the real worker', async () => {
    const databaseFile = copyProductionDatabase('healthy.sqlite')
    const before = {
      hash: sha256(databaseFile),
      mtimeMs: statSync(databaseFile).mtimeMs,
      size: statSync(databaseFile).size,
      sidecars: sidecarState(databaseFile)
    }

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(migrationDatabaseDiagnosticResultSchema.parse(result)).toEqual(result)
    expect(migrationDatabaseDiagnosticsWorkerMessageSchema.parse({ type: 'result', result })).toEqual({
      type: 'result',
      result
    })
    expect(result.l0).toMatchObject({ status: 'success', data: { fileKind: 'regular', header: 'valid' } })
    expect(result.l1.status).toBe('success')
    expect(result.l2).toMatchObject({
      status: 'success',
      data: {
        quickCheck: { outcome: 'ok', truncated: false },
        foreignKeys: { outcome: 'ok', truncated: false }
      }
    })
    if (result.l1.status === 'success' || result.l1.status === 'truncated') {
      expect(result.l1.data.objects).toHaveLength(EXPECTED_MIGRATION_DATABASE_OBJECTS.length)
      expect(result.l1.data.objects.every((object) => object.status === 'ok')).toBe(true)
      expect(result.l1.data.unknownObjects).toEqual([])
      expect(result.l1.data.metadata.queryOnly).toBe(true)
    }

    expect({
      hash: sha256(databaseFile),
      mtimeMs: statSync(databaseFile).mtimeMs,
      size: statSync(databaseFile).size,
      sidecars: sidecarState(databaseFile)
    }).toEqual(before)

    const renamed = `${databaseFile}.renamed`
    renameSync(databaseFile, renamed)
    const reopened = new Database(renamed, { readonly: true, fileMustExist: true })
    expect(reopened.pragma('quick_check(1)', { simple: true })).toBe('ok')
    reopened.close()
    renameSync(renamed, databaseFile)
  })

  it('reports a missing database without creating it or any SQLite sidecar', async () => {
    const databaseFile = join(fixtureDir, 'missing.sqlite')

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l0).toEqual({
      level: 'l0',
      status: 'success',
      data: {
        exists: false,
        fileKind: 'missing',
        sizeBucket: 'unavailable',
        mtimeAgeBucket: 'unavailable',
        header: 'unavailable',
        writeMode: 'unavailable',
        walSidecars: 'none'
      }
    })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'open_failed' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'open_failed' })
    expect(existsSync(databaseFile)).toBe(false)
    expect(sidecarState(databaseFile)).toEqual({ '-wal': false, '-shm': false, '-journal': false })
  })

  it('reads a live WAL snapshot while preserving the main database and WAL files', async () => {
    const databaseFile = copyProductionDatabase('live-wal.sqlite')
    const walFile = `${databaseFile}-wal`
    const shmFile = `${databaseFile}-shm`
    const writer = new Database(databaseFile)

    try {
      expect(writer.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
      writer.pragma('wal_autocheckpoint = 0')
      writer.exec('CREATE INDEX wal_visibility_marker_idx ON preference(key)')
      const before = {
        main: fileFingerprint(databaseFile),
        wal: fileFingerprint(walFile),
        shm: fileFingerprint(shmFile)
      }
      expect(before.main).toMatchObject({ exists: true, regular: true })
      expect(before.wal).toMatchObject({ exists: true, regular: true })
      expect(before.shm).toMatchObject({ exists: true, regular: true })

      const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
      expectCompleted(result)

      expect(result.l0).toMatchObject({
        status: 'success',
        data: { writeMode: 'wal', walSidecars: 'complete' }
      })
      expect(result.l1.status).toBe('success')
      if (result.l1.status === 'success' || result.l1.status === 'truncated') {
        expect(result.l1.data.unknownObjects).toContainEqual({ kind: 'index', countBucket: '1' })
      }
      expect(fileFingerprint(databaseFile)).toEqual(before.main)
      expect(fileFingerprint(walFile)).toEqual(before.wal)
      expect(fileFingerprint(shmFile)).toMatchObject({ exists: true, regular: true })

      expect(() => writer.exec('CREATE INDEX wal_after_diagnostics_idx ON preference(value)')).not.toThrow()
      expect(() => writer.pragma('wal_checkpoint(PASSIVE)')).not.toThrow()
    } finally {
      writer.close()
    }
  })

  it('does not open a database when a WAL exists without SHM', async () => {
    const databaseFile = copyProductionDatabase('wal-without-shm.sqlite')
    const walFile = `${databaseFile}-wal`
    const shmFile = `${databaseFile}-shm`
    writeFileSync(walFile, Buffer.from('bounded-wal-canary'))
    const before = { main: fileFingerprint(databaseFile), wal: fileFingerprint(walFile) }

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l0).toMatchObject({
      status: 'success',
      data: { walSidecars: 'wal_only' }
    })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(fileFingerprint(databaseFile)).toEqual(before.main)
    expect(fileFingerprint(walFile)).toEqual(before.wal)
    expect(existsSync(shmFile)).toBe(false)
  })

  it.each(['wal', 'shm'] as const)('rejects a symlinked %s sidecar before opening SQLite', async (unsafeKind) => {
    const databaseFile = copyProductionDatabase(`unsafe-${unsafeKind}-sidecar.sqlite`)
    const target = join(fixtureDir, `${unsafeKind}-sidecar-target`)
    const walFile = `${databaseFile}-wal`
    const shmFile = `${databaseFile}-shm`
    writeFileSync(target, Buffer.from('sidecar-target-canary'))
    if (unsafeKind === 'wal') {
      symlinkSync(target, walFile)
      writeFileSync(shmFile, Buffer.from('regular-shm-canary'))
    } else {
      writeFileSync(walFile, Buffer.from('regular-wal-canary'))
      symlinkSync(target, shmFile)
    }

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l0).toMatchObject({ status: 'success', data: { walSidecars: 'unsafe' } })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(lstatSync(unsafeKind === 'wal' ? walFile : shmFile).isSymbolicLink()).toBe(true)
  })

  it('does not open a clean WAL-mode database when no sidecars exist', async () => {
    const databaseFile = copyProductionDatabase('clean-wal-header.sqlite')
    const fixture = new Database(databaseFile)
    expect(fixture.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
    fixture.pragma('wal_checkpoint(TRUNCATE)')
    fixture.close()
    expect(sidecarState(databaseFile)).toMatchObject({ '-wal': false, '-shm': false })
    const before = fileFingerprint(databaseFile)

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l0).toMatchObject({
      status: 'success',
      data: { writeMode: 'wal', walSidecars: 'none' }
    })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'wal_sidecars_unavailable' })
    expect(fileFingerprint(databaseFile)).toEqual(before)
    expect(sidecarState(databaseFile)).toMatchObject({ '-wal': false, '-shm': false })
  })

  it('allows a live WAL writer to commit and checkpoint after host timeout termination', async () => {
    const databaseFile = copyProductionDatabase('wal-timeout.sqlite')
    const writer = new Database(databaseFile)

    try {
      expect(writer.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
      writer.pragma('wal_autocheckpoint = 0')
      writer.exec('CREATE INDEX wal_timeout_before_idx ON preference(key)')

      const result = await new MigrationDatabaseDiagnostics({ timeoutMs: 1 }).inspect(databaseFile)
      expect(result.completion).toEqual({ status: 'timed_out', code: 'worker_timeout' })
      expect(() => writer.exec('CREATE INDEX wal_timeout_after_idx ON preference(value)')).not.toThrow()
      expect(() => writer.pragma('wal_checkpoint(PASSIVE)')).not.toThrow()
    } finally {
      writer.close()
    }
  })

  it('reports a missing expected object from a production-schema copy', async () => {
    const databaseFile = copyProductionDatabase('schema-mismatch.sqlite')
    const fixture = new Database(databaseFile)
    fixture.exec('DROP TABLE preference')
    fixture.close()

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l1.status).toBe('success')
    if (result.l1.status === 'success' || result.l1.status === 'truncated') {
      expect(result.l1.data.objects.find((object) => object.id === 'preference')).toMatchObject({
        kind: 'table',
        status: 'missing',
        columnCountBucket: 'unavailable'
      })
    }
  })

  it('maps a foreign-key violation to known IDs without rowid or fkid', async () => {
    const databaseFile = copyProductionDatabase('foreign-key.sqlite')
    const fixture = new Database(databaseFile)
    fixture.pragma('foreign_keys = OFF')
    fixture
      .prepare(
        'INSERT INTO assistant_knowledge_base (assistant_id, knowledge_base_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run('missing-assistant', 'missing-knowledge', 1, 1)
    fixture.close()

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l2.status).toBe('success')
    if (result.l2.status === 'success' || result.l2.status === 'truncated') {
      expect(result.l2.data.foreignKeys.outcome).toBe('violations')
      expect(result.l2.data.foreignKeys.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ childObjectId: 'assistant_knowledge_base', countBucket: '1' })
        ])
      )
    }
    expect(JSON.stringify(result)).not.toMatch(/rowid|fkid/i)
  })

  it('reports a truncated copy without returning header bytes or SQLite text', async () => {
    const databaseFile = join(fixtureDir, 'truncated.sqlite')
    writeFileSync(databaseFile, readFileSync(dbh.sqlite.name).subarray(0, 8))

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l0).toMatchObject({ status: 'success', data: { header: 'insufficient' } })
    expect(result.l1).toMatchObject({ status: 'failed', code: 'not_database' })
    expect(result.l2).toMatchObject({ status: 'failed', code: 'not_database' })
    expect(JSON.stringify(result)).not.toContain('SQLite format')
  })

  it('round-trips a short SQLite magic probe as an insufficient header', async () => {
    const databaseFile = join(fixtureDir, 'short-sqlite-magic.sqlite')
    writeFileSync(databaseFile, Buffer.from('SQLite format 3\0', 'binary'))

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(migrationDatabaseDiagnosticsWorkerMessageSchema.parse({ type: 'result', result })).toEqual({
      type: 'result',
      result
    })
    expect(result.l0).toMatchObject({
      status: 'success',
      data: { sizeBucket: 'under_4_kib', header: 'insufficient', writeMode: 'unavailable' }
    })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'not_database' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'not_database' })
  })

  it.runIf(typeof process.getuid !== 'function' || process.getuid() !== 0)(
    'returns safe failures for an unreadable regular file',
    async () => {
      const databaseFile = copyProductionDatabase('unreadable.sqlite')
      chmodSync(databaseFile, 0o000)

      try {
        const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
        expectCompleted(result)
        expect(result.l0).toMatchObject({ status: 'failed', code: 'permission_denied' })
        expect(result.l1).toMatchObject({ status: 'failed', code: 'permission_denied' })
        expect(result.l2).toMatchObject({ status: 'failed', code: 'permission_denied' })
        expect(JSON.stringify(result)).not.toContain(databaseFile)
      } finally {
        chmodSync(databaseFile, 0o600)
      }
    }
  )

  it.each(['directory', 'symlink'] as const)('observes a %s as non-regular without following it', async (kind) => {
    const target = copyProductionDatabase('nonregular-target.sqlite')
    const databaseFile = join(fixtureDir, `nonregular-${kind}`)
    if (kind === 'directory') {
      mkdirSync(databaseFile)
    } else {
      symlinkSync(target, databaseFile)
    }

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(lstatSync(databaseFile).isFile()).toBe(false)
    expect(result.l0).toMatchObject({ status: 'success', data: { exists: true, fileKind: 'not_regular' } })
    expect(result.l1).toMatchObject({ status: 'failed', code: 'not_regular_file' })
    expect(result.l2).toMatchObject({ status: 'failed', code: 'not_regular_file' })
  })

  it('counts unknown objects by type without exposing their names', async () => {
    const databaseFile = copyProductionDatabase('unknown-object.sqlite')
    const fixture = new Database(databaseFile)
    fixture.exec('CREATE TABLE secret_customer_message_canary (value TEXT)')
    fixture.close()

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l1.status).toBe('success')
    if (result.l1.status === 'success' || result.l1.status === 'truncated') {
      expect(result.l1.data.unknownObjects).toContainEqual({ kind: 'table', countBucket: '1' })
    }
    expect(JSON.stringify(result)).not.toContain('secret_customer_message_canary')
  })

  it('streams and truncates a large foreign-key check result', async () => {
    const databaseFile = copyProductionDatabase('many-foreign-keys.sqlite')
    const fixture = new Database(databaseFile)
    fixture.pragma('foreign_keys = OFF')
    const insert = fixture.prepare(
      'INSERT INTO assistant_knowledge_base (assistant_id, knowledge_base_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    const insertMany = fixture.transaction(() => {
      for (let index = 0; index < 300; index += 1) {
        insert.run(`missing-assistant-${index}`, `missing-knowledge-${index}`, index, index)
      }
    })
    insertMany()
    fixture.close()

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
    expectCompleted(result)

    expect(result.l2.status).toBe('truncated')
    if (result.l2.status === 'truncated') {
      expect(result.l2.data.foreignKeys).toMatchObject({
        outcome: 'violations',
        scannedCountBucket: '101_to_256',
        truncated: true
      })
      expect(result.l2.data.foreignKeys.violations.length).toBeLessThanOrEqual(64)
    }
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(64 * 1024)
  })

  it('rejects a malformed cloned policy without echoing it or the database path', async () => {
    const pathCanary = '/private/policy-path-canary.sqlite'
    const payloadCanary = 'secret-policy-payload-canary'
    const worker = new Worker(
      `${process.cwd()}/src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsWorker.ts`,
      {
        workerData: {
          databaseFile: pathCanary,
          policy: {
            version: 1,
            expectedSchemaVersion: 1,
            maxMessageBytes: 65_536,
            maxSchemaObjects: 160,
            maxForeignKeyRows: 256,
            maxForeignKeyGroups: 64,
            expectedObjects: [
              {
                id: 'safe_object_id',
                name: { payload: payloadCanary },
                kind: 'index'
              }
            ]
          }
        },
        execArgv: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']
      }
    )
    const messages: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      worker.on('message', (message) => messages.push(message))
      worker.once('error', reject)
      worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))))
    })

    const finalMessage = messages.find(
      (message): message is { type: 'result'; result: unknown } =>
        message !== null && typeof message === 'object' && 'type' in message && message.type === 'result'
    )
    expect(finalMessage?.result).toMatchObject({
      l0: { status: 'failed', code: 'invalid_input' },
      l1: { status: 'failed', code: 'invalid_input' },
      l2: { status: 'failed', code: 'invalid_input' }
    })
    expect(JSON.stringify(messages)).not.toContain(pathCanary)
    expect(JSON.stringify(messages)).not.toContain(payloadCanary)
  })

  it('does not accept a caller-supplied arbitrary safe schema ID', async () => {
    const databaseFile = join(fixtureDir, 'arbitrary-policy.sqlite')
    const worker = new Worker(
      `${process.cwd()}/src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsWorker.ts`,
      {
        workerData: {
          databaseFile,
          policy: {
            version: 1,
            expectedSchemaVersion: 1,
            maxMessageBytes: 65_536,
            maxSchemaObjects: 160,
            maxForeignKeyRows: 256,
            maxForeignKeyGroups: 64,
            expectedObjects: [{ id: 'arbitrary_but_safe_id', kind: 'index' }]
          }
        },
        execArgv: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']
      }
    )
    const messages: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      worker.on('message', (message) => messages.push(message))
      worker.once('error', reject)
      worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))))
    })

    const finalMessage = messages.find(
      (message): message is { type: 'result'; result: unknown } =>
        message !== null && typeof message === 'object' && 'type' in message && message.type === 'result'
    )
    expect(finalMessage?.result).toMatchObject({
      l0: { status: 'failed', code: 'invalid_input' },
      l1: { status: 'failed', code: 'invalid_input' },
      l2: { status: 'failed', code: 'invalid_input' }
    })
    expect(existsSync(databaseFile)).toBe(false)
  })
})
