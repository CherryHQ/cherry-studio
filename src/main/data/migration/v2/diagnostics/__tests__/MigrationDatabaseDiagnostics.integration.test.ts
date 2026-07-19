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
  migrationDatabaseDiagnosticResultSchema
} from '../migrationDatabaseDiagnosticsSchemas'

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function sidecarState(file: string): Record<string, boolean> {
  return Object.fromEntries(['-wal', '-shm', '-journal'].map((suffix) => [suffix, existsSync(`${file}${suffix}`)]))
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

    expect(migrationDatabaseDiagnosticResultSchema.parse(result)).toEqual(result)
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

  it('reports a missing expected object from a production-schema copy', async () => {
    const databaseFile = copyProductionDatabase('schema-mismatch.sqlite')
    const fixture = new Database(databaseFile)
    fixture.exec('DROP TABLE preference')
    fixture.close()

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

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

    expect(result.l0).toMatchObject({ status: 'success', data: { header: 'insufficient' } })
    expect(result.l1).toMatchObject({ status: 'failed', code: 'not_database' })
    expect(result.l2).toMatchObject({ status: 'failed', code: 'not_database' })
    expect(JSON.stringify(result)).not.toContain('SQLite format')
  })

  it.runIf(typeof process.getuid !== 'function' || process.getuid() !== 0)(
    'returns safe failures for an unreadable regular file',
    async () => {
      const databaseFile = copyProductionDatabase('unreadable.sqlite')
      chmodSync(databaseFile, 0o000)

      try {
        const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
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

    expect(result.l2.status).toBe('truncated')
    if (result.l2.status === 'truncated') {
      expect(result.l2.data.foreignKeys).toMatchObject({ outcome: 'violations', truncated: true })
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
})
