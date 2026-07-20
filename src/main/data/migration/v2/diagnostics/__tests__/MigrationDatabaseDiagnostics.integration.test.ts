import { spawn } from 'node:child_process'
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
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../migrationDatabaseDiagnosticsChild?modulePath', () => ({
  default: `${process.cwd()}/src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts`
}))

import { MigrationDbService } from '../../core/MigrationDbService'
import type { MigrationPaths } from '../../core/MigrationPaths'
import { MigrationDatabaseDiagnostics, type MigrationDatabaseDiagnosticsLease } from '../MigrationDatabaseDiagnostics'
import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  type MigrationDatabaseCompletedDiagnosticResult,
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema,
  migrationDatabaseDiagnosticsChildMessageSchema
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

function createPaths(databaseFile: string): MigrationPaths {
  const root = dirname(databaseFile)
  return {
    userData: root,
    cherryHome: root,
    databaseFile,
    knowledgeBaseDir: join(root, 'Data', 'KnowledgeBase'),
    filesDataDir: join(root, 'Data', 'Files'),
    versionLogFile: join(root, 'version.log'),
    legacyAgentDbFile: join(root, 'Data', 'agents.db'),
    agentWorkspacesDir: join(root, 'Data', 'Agents'),
    customMiniAppsFile: join(root, 'Data', 'Files', 'custom-minapps.json'),
    diagnosticsJournalFile: join(root, 'migration-diagnostics-v2.json'),
    legacyDiagnosticsJournalFile: join(root, 'migration-diagnostics-v1.json'),
    legacyConfigFile: join(root, 'config.json'),
    migrationsFolder: join(process.cwd(), 'migrations', 'sqlite-drizzle')
  }
}

function fileIdentity(file: string): { readonly device: string; readonly inode: string } {
  const stats = lstatSync(file, { bigint: true })
  return { device: stats.dev.toString(), inode: stats.ino.toString() }
}

function expectCompleted(
  result: MigrationDatabaseDiagnosticResult
): asserts result is MigrationDatabaseCompletedDiagnosticResult {
  expect(result.completion.status).toBe('completed')
  if (result.completion.status !== 'completed') throw new Error('Expected the isolated child to complete')
}

describe('MigrationDatabaseDiagnostics integration', () => {
  const dbh = setupTestDatabase()
  let fixtureDir: string
  let services: MigrationDbService[]

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'migration-db-diagnostics-'))
    services = []
  })

  afterEach(() => {
    for (const service of services) service.close()
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

  function openMigrationService(databaseFile: string): MigrationDbService {
    const service = MigrationDbService.create(createPaths(databaseFile))
    services.push(service)
    return service
  }

  async function inspectFull(service: MigrationDbService): Promise<MigrationDatabaseDiagnosticResult> {
    const leased = await service.withDiagnosticsLease((lease) =>
      new MigrationDatabaseDiagnostics().inspectWithLease(lease)
    )
    expect(leased.kind).toBe('leased')
    if (leased.kind !== 'leased') throw new Error('Expected a live MigrationDbService diagnostics lease')
    return leased.value
  }

  it('inspects a healthy production database under a real lease without changing it', async () => {
    const databaseFile = copyProductionDatabase('healthy.sqlite')
    const service = openMigrationService(databaseFile)
    const walFile = `${databaseFile}-wal`
    const before = {
      main: fileFingerprint(databaseFile),
      wal: fileFingerprint(walFile),
      shm: fileFingerprint(`${databaseFile}-shm`)
    }

    const result = await inspectFull(service)
    expectCompleted(result)

    expect(migrationDatabaseDiagnosticResultSchema.parse(result)).toEqual(result)
    expect(migrationDatabaseDiagnosticsChildMessageSchema.parse({ type: 'result', result })).toEqual({
      type: 'result',
      result
    })
    expect(result.l0).toMatchObject({
      status: 'success',
      data: { fileKind: 'regular', header: 'valid', writeMode: 'wal', walSidecars: 'complete' }
    })
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
    expect(fileFingerprint(databaseFile)).toEqual(before.main)
    expect(fileFingerprint(walFile)).toEqual(before.wal)
    expect(before.shm).toMatchObject({ exists: true, regular: true })
    expect(fileFingerprint(`${databaseFile}-shm`)).toMatchObject({ exists: true, regular: true })

    service.close()
    const renamed = `${databaseFile}.renamed`
    renameSync(databaseFile, renamed)
    const reopened = new Database(renamed, { readonly: true, fileMustExist: true })
    expect(reopened.pragma('quick_check(1)', { simple: true })).toBe('ok')
    reopened.close()
    renameSync(renamed, databaseFile)
  })

  it('reports only L0 and lease_unavailable for a missing database without creating anything', async () => {
    const databaseFile = join(fixtureDir, 'missing.sqlite')

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

    expect(result).toEqual({
      version: 1,
      expectedSchemaVersion: 1,
      completion: { status: 'failed', code: 'lease_unavailable' },
      l0: {
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
      }
    })
    expect(existsSync(databaseFile)).toBe(false)
    expect(sidecarState(databaseFile)).toEqual({ '-wal': false, '-shm': false, '-journal': false })
  })

  it('reads a live WAL-only schema marker while preserving the writer files', async () => {
    const databaseFile = copyProductionDatabase('live-wal.sqlite')
    const service = openMigrationService(databaseFile)
    service.getDb().run(sql`CREATE INDEX wal_visibility_marker_idx ON preference(key)`)
    const walFile = `${databaseFile}-wal`
    const shmFile = `${databaseFile}-shm`
    const before = { main: fileFingerprint(databaseFile), wal: fileFingerprint(walFile) }

    const result = await inspectFull(service)
    expectCompleted(result)

    expect(result.l0).toMatchObject({ status: 'success', data: { writeMode: 'wal', walSidecars: 'complete' } })
    expect(result.l1.status).toBe('success')
    if (result.l1.status === 'success' || result.l1.status === 'truncated') {
      expect(result.l1.data.unknownObjects).toContainEqual({ kind: 'index', countBucket: '1' })
    }
    expect(fileFingerprint(databaseFile)).toEqual(before.main)
    expect(fileFingerprint(walFile)).toEqual(before.wal)
    expect(fileFingerprint(shmFile)).toMatchObject({ exists: true, regular: true })
    expect(() => service.getDb().run(sql`CREATE INDEX wal_after_diagnostics_idx ON preference(value)`)).not.toThrow()
    expect(() => service.getDb().all(sql`PRAGMA wal_checkpoint(PASSIVE)`)).not.toThrow()
  })

  it('stays at L0 when a WAL exists without SHM', async () => {
    const databaseFile = copyProductionDatabase('wal-without-shm.sqlite')
    const walFile = `${databaseFile}-wal`
    const shmFile = `${databaseFile}-shm`
    writeFileSync(walFile, Buffer.from('bounded-wal-canary'))
    const before = { main: fileFingerprint(databaseFile), wal: fileFingerprint(walFile) }

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

    expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
    expect(result.l0).toMatchObject({ status: 'success', data: { walSidecars: 'wal_only' } })
    expect(result).not.toHaveProperty('l1')
    expect(result).not.toHaveProperty('l2')
    expect(fileFingerprint(databaseFile)).toEqual(before.main)
    expect(fileFingerprint(walFile)).toEqual(before.wal)
    expect(existsSync(shmFile)).toBe(false)
  })

  it.each(['wal', 'shm'] as const)('stays at L0 for a symlinked %s sidecar', async (unsafeKind) => {
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

    expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
    expect(result.l0).toMatchObject({ status: 'success', data: { walSidecars: 'unsafe' } })
    expect(result).not.toHaveProperty('l1')
    expect(result).not.toHaveProperty('l2')
    expect(lstatSync(unsafeKind === 'wal' ? walFile : shmFile).isSymbolicLink()).toBe(true)
  })

  it('does not open a clean WAL-mode database when no lease or sidecars exist', async () => {
    const databaseFile = copyProductionDatabase('clean-wal-header.sqlite')
    const fixture = new Database(databaseFile)
    expect(fixture.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
    fixture.pragma('wal_checkpoint(TRUNCATE)')
    fixture.close()
    const before = fileFingerprint(databaseFile)

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

    expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
    expect(result.l0).toMatchObject({ status: 'success', data: { writeMode: 'wal', walSidecars: 'none' } })
    expect(result).not.toHaveProperty('l1')
    expect(result).not.toHaveProperty('l2')
    expect(fileFingerprint(databaseFile)).toEqual(before)
    expect(sidecarState(databaseFile)).toMatchObject({ '-wal': false, '-shm': false })
  })

  it('reports a missing expected object from a production-schema database', async () => {
    const service = openMigrationService(copyProductionDatabase('schema-mismatch.sqlite'))
    service.getDb().run(sql.raw('DROP TABLE preference'))

    const result = await inspectFull(service)
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
    const service = openMigrationService(copyProductionDatabase('foreign-key.sqlite'))
    service.getDb().run(sql`
      INSERT INTO assistant_knowledge_base (assistant_id, knowledge_base_id, created_at, updated_at)
      VALUES ('missing-assistant', 'missing-knowledge', 1, 1)
    `)

    const result = await inspectFull(service)
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

  it.each([
    { name: 'truncated copy', bytes: () => readFileSync(dbh.sqlite.name).subarray(0, 8), header: 'insufficient' },
    { name: 'short magic', bytes: () => Buffer.from('SQLite format 3\0', 'binary'), header: 'insufficient' }
  ])('reports only L0 for a $name', async ({ bytes, header }) => {
    const databaseFile = join(fixtureDir, 'short.sqlite')
    writeFileSync(databaseFile, bytes())

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

    expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
    expect(result.l0).toMatchObject({ status: 'success', data: { header, writeMode: 'unavailable' } })
    expect(result).not.toHaveProperty('l1')
    expect(result).not.toHaveProperty('l2')
    expect(JSON.stringify(result)).not.toContain('SQLite format')
  })

  it.runIf(typeof process.getuid !== 'function' || process.getuid() !== 0)(
    'returns a safe L0 failure for an unreadable regular file',
    async () => {
      const databaseFile = copyProductionDatabase('unreadable.sqlite')
      chmodSync(databaseFile, 0o000)
      try {
        const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)
        expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
        expect(result.l0).toMatchObject({ status: 'failed', code: 'permission_denied' })
        expect(result).not.toHaveProperty('l1')
        expect(JSON.stringify(result)).not.toContain(databaseFile)
      } finally {
        chmodSync(databaseFile, 0o600)
      }
    }
  )

  it.each(['directory', 'symlink'] as const)('observes a %s as non-regular without following it', async (kind) => {
    const target = copyProductionDatabase('nonregular-target.sqlite')
    const databaseFile = join(fixtureDir, `nonregular-${kind}`)
    if (kind === 'directory') mkdirSync(databaseFile)
    else symlinkSync(target, databaseFile)

    const result = await new MigrationDatabaseDiagnostics().inspect(databaseFile)

    expect(result.completion).toEqual({ status: 'failed', code: 'lease_unavailable' })
    expect(result.l0).toMatchObject({ status: 'success', data: { exists: true, fileKind: 'not_regular' } })
    expect(result).not.toHaveProperty('l1')
  })

  it('counts unknown objects by type without exposing their names', async () => {
    const service = openMigrationService(copyProductionDatabase('unknown-object.sqlite'))
    service.getDb().run(sql.raw('CREATE TABLE secret_customer_message_canary (value TEXT)'))

    const result = await inspectFull(service)
    expectCompleted(result)

    expect(result.l1.status).toBe('success')
    if (result.l1.status === 'success' || result.l1.status === 'truncated') {
      expect(result.l1.data.unknownObjects).toContainEqual({ kind: 'table', countBucket: '1' })
    }
    expect(JSON.stringify(result)).not.toContain('secret_customer_message_canary')
  })

  it('streams and truncates a large foreign-key check result', async () => {
    const service = openMigrationService(copyProductionDatabase('many-foreign-keys.sqlite'))
    const db = service.getDb()
    db.transaction((tx) => {
      for (let index = 0; index < 300; index += 1) {
        tx.run(sql`
          INSERT INTO assistant_knowledge_base (assistant_id, knowledge_base_id, created_at, updated_at)
          VALUES (${`missing-assistant-${index}`}, ${`missing-knowledge-${index}`}, ${index}, ${index})
        `)
      }
    })

    const result = await inspectFull(service)
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

  it('drops L1/L2 data when fixed file identities do not match before open', async () => {
    const databaseFile = copyProductionDatabase('identity-mismatch.sqlite')
    openMigrationService(databaseFile)
    const before = {
      main: fileFingerprint(databaseFile),
      wal: fileFingerprint(`${databaseFile}-wal`),
      shm: fileFingerprint(`${databaseFile}-shm`)
    }
    const forgedLease = {
      databaseFile,
      identity: {
        database: fileIdentity(databaseFile),
        wal: { ...fileIdentity(`${databaseFile}-wal`), inode: '0' },
        shm: fileIdentity(`${databaseFile}-shm`)
      }
    } as MigrationDatabaseDiagnosticsLease

    const result = await new MigrationDatabaseDiagnostics().inspectWithLease(forgedLease)
    expectCompleted(result)

    expect(result.l0).toMatchObject({ status: 'success', data: { walSidecars: 'complete' } })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'identity_mismatch' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'identity_mismatch' })
    expect(fileFingerprint(databaseFile)).toEqual(before.main)
    expect(fileFingerprint(`${databaseFile}-wal`)).toEqual(before.wal)
    expect(fileFingerprint(`${databaseFile}-shm`)).toEqual(before.shm)
  })

  it('rejects caller-supplied policy/SQL-shaped input without echoing it or creating a database', async () => {
    const databaseFile = join(fixtureDir, 'arbitrary-input.sqlite')
    const pathCanary = `${databaseFile}-private-canary`
    const payloadCanary = 'SELECT secret_customer_message FROM private_table'
    const childPath = `${process.cwd()}/src/main/data/migration/v2/diagnostics/migrationDatabaseDiagnosticsChild.ts`
    const child = spawn(process.execPath, [childPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        CHERRY_MIGRATION_DATABASE_DIAGNOSTICS_CHILD: '1'
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      shell: false
    })
    child.stderr?.resume()
    const messages: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      child.on('message', (message) => {
        if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'ready') {
          child.send({ databaseFile: pathCanary, policy: { sql: payloadCanary } })
        } else {
          messages.push(message)
        }
      })
      child.once('error', reject)
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child exit ${code}`))))
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
    expect(existsSync(databaseFile)).toBe(false)
  })
})
