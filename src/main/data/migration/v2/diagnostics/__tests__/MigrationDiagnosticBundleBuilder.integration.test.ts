import { createWriteStream } from 'node:fs'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MigrationDatabaseDiagnosticResult } from '../migrationDatabaseDiagnosticsSchemas'
import {
  MIGRATION_DIAGNOSTIC_STRICT_ENTRIES,
  MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'
import {
  migrationDatabaseDiagnosticsDocumentSchema,
  migrationDiagnosticEventsDocumentSchema,
  migrationDiagnosticManifestSchema
} from '../migrationDiagnosticBundleSchemas'
import type { MigrationDiagnosticsSession } from '../migrationDiagnosticsSchemas'

const STARTED_AT = '2026-07-19T10:00:00.000Z'
const ENDED_AT = '2026-07-19T10:01:00.000Z'

function databaseUnavailable(): MigrationDatabaseDiagnosticResult {
  return {
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'failed', code: 'lease_unavailable' }
  }
}

function snapshotWithCanaries(canaries: readonly string[]): MigrationDiagnosticsSession {
  const attempts = canaries.slice(0, 5).map((canary, attemptIndex) => {
    const id = canary.slice(0, 64)
    return {
      id,
      trigger: attemptIndex === 0 ? ('initial' as const) : ('manual_retry' as const),
      startedAt: STARTED_AT,
      outcome: 'failed' as const,
      endedAt: ENDED_AT,
      events: [
        {
          sequence: attemptIndex + 1,
          at: ENDED_AT,
          attemptId: id,
          scope: 'migrator' as const,
          phase: 'execute' as const,
          state: 'failed' as const,
          code: 'unknown' as const,
          migratorId: canaries[attemptIndex + 5]?.slice(0, 64)
        }
      ]
    }
  })
  return {
    version: 1,
    sessionId: canaries[10]?.slice(0, 64) ?? 'private-session',
    appVersion: canaries[11]?.slice(0, 64) ?? 'not-a-version',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: STARTED_AT,
    state: 'failed',
    attempts
  }
}

async function readZip(
  file: string
): Promise<{ entries: Record<string, StreamZip.ZipEntry>; data: Map<string, Buffer> }> {
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const data = new Map<string, Buffer>()
    for (const name of Object.keys(entries)) data.set(name, await zip.entryData(name))
    return { entries, data }
  } finally {
    await zip.close()
  }
}

interface CustomZipOptions {
  readonly comment?: string
  readonly replaceReadmeWithSymlink?: boolean
}

async function customZip(
  entries: ReadonlyArray<readonly [string, Buffer]>,
  options: CustomZipOptions = {}
): Promise<Buffer> {
  const outputFile = path.join(testDir, `custom-${Math.random()}.zip`)
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputFile)
    const archive = new ZipArchive({
      zlib: { level: 1 },
      ...(options.comment === undefined ? {} : { comment: options.comment })
    })
    output.once('close', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.pipe(output)
    for (const [name, buffer] of entries) {
      if (options.replaceReadmeWithSymlink && name === 'README.txt') archive.symlink(name, buffer.toString('utf8'))
      else archive.append(buffer, { name })
    }
    void archive.finalize()
  })
  return readFileSync(outputFile)
}

let testDir = ''

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-bundle-integration-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('strict diagnostic ZIP integration', () => {
  it('round-trips exactly four fixed top-level regular files within the uncompressed budget', async () => {
    const destination = path.join(testDir, 'strict.zip')
    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: snapshotWithCanaries(['attempt']),
      collectDatabaseDiagnostics: async () => databaseUnavailable()
    })

    expect(result.status).toBe('saved')
    const archive = await readZip(destination)
    expect(Object.keys(archive.entries)).toEqual([...MIGRATION_DIAGNOSTIC_STRICT_ENTRIES])
    expect(Object.values(archive.entries).every((entry) => entry.isFile && !entry.isDirectory)).toBe(true)
    expect(Object.keys(archive.entries).every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true)
    expect([...archive.data.values()].reduce((total, entry) => total + entry.byteLength, 0)).toBeLessThanOrEqual(
      MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES
    )
    migrationDiagnosticManifestSchema.parse(JSON.parse(archive.data.get('manifest.json')?.toString('utf8') ?? ''))
    migrationDiagnosticEventsDocumentSchema.parse(
      JSON.parse(archive.data.get('migration-events.json')?.toString('utf8') ?? '')
    )
    migrationDatabaseDiagnosticsDocumentSchema.parse(
      JSON.parse(archive.data.get('database-diagnostics.json')?.toString('utf8') ?? '')
    )
  })

  it('canonicalizes every legal free-string field and scans all extracted bytes for privacy canaries', async () => {
    const canaries = [
      'USER_MESSAGE_canary_do_not_share',
      '/Users/alice/private-home',
      '/private/userData/cherrystudio',
      'sk-proj-OPENAI_CANARY',
      'sk-ant-ANTHROPIC_CANARY',
      'ghp_GITHUB_CANARY_123456',
      'AKIAAWSACCESSCANARY',
      'Bearer PRIVATE_BEARER',
      'cookie=PRIVATE_COOKIE',
      'password=PRIVATE_PASSWORD',
      'alice.private@example.com',
      'device-id-private-1234'
    ] as const
    const destination = path.join(testDir, 'privacy.zip')
    const rawCollectorCanaries = [
      '-----BEGIN PRIVATE KEY-----PRIVATE_PEM',
      'postgresql://alice:secret@localhost/private',
      'account-id-private-123',
      'user-id-private-456',
      'Error at /Users/alice/src/private.ts:42:9'
    ]

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: snapshotWithCanaries(canaries),
      collectDatabaseDiagnostics: async () => {
        throw new Error(rawCollectorCanaries.join('|'))
      }
    })

    expect(result.status).toBe('saved')
    const { data } = await readZip(destination)
    const allBytes = Buffer.concat([...data.values()]).toString('utf8')
    for (const canary of [...canaries, ...rawCollectorCanaries]) expect(allBytes).not.toContain(canary)
    expect(allBytes).not.toMatch(/cherrystudio\.sqlite(?:-wal|-shm)?/)
    expect(allBytes).not.toMatch(/migration-diagnostics-v1|migration_temp|migrationExport/i)
    const events = migrationDiagnosticEventsDocumentSchema.parse(
      JSON.parse(data.get('migration-events.json')?.toString('utf8') ?? '')
    )
    expect(events.session.appVersion).toBe('unknown')
    expect(events.attempts.map((attempt) => attempt.id)).toEqual([
      'attempt-1',
      'attempt-2',
      'attempt-3',
      'attempt-4',
      'attempt-5'
    ])
    expect(events.attempts.map((attempt) => attempt.events[0]?.migratorId)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown'
    ])
  })

  it('turns invalid or throwing database collectors into typed unavailable diagnostics without leaking errors', async () => {
    const destinations = [path.join(testDir, 'invalid-db.zip'), path.join(testDir, 'throwing-db.zip')]
    const collectors = [
      async () =>
        ({ ...databaseUnavailable(), rawError: 'INVALID_DB_CANARY' }) as unknown as MigrationDatabaseDiagnosticResult,
      async () => {
        throw new Error('THROWING_DB_CANARY_/Users/alice')
      }
    ]

    for (const [index, collectDatabaseDiagnostics] of collectors.entries()) {
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination: destinations[index],
        snapshot: snapshotWithCanaries(['attempt']),
        collectDatabaseDiagnostics
      })
      expect(result.status).toBe('saved')
      const { data } = await readZip(destinations[index])
      const database = migrationDatabaseDiagnosticsDocumentSchema.parse(
        JSON.parse(data.get('database-diagnostics.json')?.toString('utf8') ?? '')
      )
      expect(database.completion).toEqual({ status: 'failed', code: 'process_error' })
      expect(database.levels).toEqual({})
      expect(Buffer.concat([...data.values()]).toString('utf8')).not.toMatch(/INVALID_DB_CANARY|THROWING_DB_CANARY/)
    }
  })

  it('rejects an archive containing an extra or traversal entry and removes the exact partial', async () => {
    const destination = path.join(testDir, 'malicious.zip')
    const builder = new MigrationDiagnosticBundleBuilder({
      createArchiveBuffer: async (entries) =>
        customZip([
          ...entries.map((entry) => [entry.name, entry.buffer] as const),
          ['../escape.txt', Buffer.from('TRAVERSAL_CANARY')]
        ])
    })

    const result = await builder.save({
      destination,
      snapshot: snapshotWithCanaries(['attempt']),
      collectDatabaseDiagnostics: async () => databaseUnavailable()
    })

    expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it.each([
    [
      'directory',
      (entries: ReadonlyArray<readonly [string, Buffer]>) => customZip([...entries, ['nested/', Buffer.alloc(0)]])
    ],
    [
      'archive comment',
      (entries: ReadonlyArray<readonly [string, Buffer]>) => customZip(entries, { comment: 'PRIVATE_COMMENT' })
    ],
    [
      'symbolic link',
      (entries: ReadonlyArray<readonly [string, Buffer]>) => customZip(entries, { replaceReadmeWithSymlink: true })
    ]
  ])('rejects an archive containing a %s entry or metadata', async (_label, createArchive) => {
    const destination = path.join(testDir, `malicious-${_label}.zip`)
    const builder = new MigrationDiagnosticBundleBuilder({
      createArchiveBuffer: async (entries) => createArchive(entries.map((entry) => [entry.name, entry.buffer] as const))
    })

    const result = await builder.save({
      destination,
      snapshot: snapshotWithCanaries(['attempt']),
      collectDatabaseDiagnostics: async () => databaseUnavailable()
    })

    expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it('returns a fixed archive failure without writing partial or echoing the raw archiver error', async () => {
    const destination = path.join(testDir, 'archive-error.zip')
    const builder = new MigrationDiagnosticBundleBuilder({
      createArchiveBuffer: async () => {
        throw new Error('ARCHIVER_PRIVATE_ERROR_/Users/alice')
      }
    })

    const result = await builder.save({
      destination,
      snapshot: snapshotWithCanaries(['attempt']),
      collectDatabaseDiagnostics: async () => databaseUnavailable()
    })

    expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
    expect(JSON.stringify(result)).not.toContain('ARCHIVER_PRIVATE_ERROR')
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it('does not package database, WAL, SHM, journal, or migration-export contents present beside destination', async () => {
    const forbidden = [
      ['cherrystudio.sqlite', 'RAW_DATABASE_CANARY'],
      ['cherrystudio.sqlite-wal', 'RAW_WAL_CANARY'],
      ['cherrystudio.sqlite-shm', 'RAW_SHM_CANARY'],
      ['migration-diagnostics-v1.json', 'RAW_JOURNAL_CANARY'],
      ['migration_temp-export.json', 'RAW_EXPORT_CANARY']
    ] as const
    for (const [name, contents] of forbidden) writeFileSync(path.join(testDir, name), contents)
    const destination = path.join(testDir, 'exclusions.zip')

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: snapshotWithCanaries(['attempt']),
      collectDatabaseDiagnostics: async () => databaseUnavailable()
    })

    expect(result.status).toBe('saved')
    const { data } = await readZip(destination)
    const allBytes = Buffer.concat([...data.values()]).toString('utf8')
    for (const [, contents] of forbidden) expect(allBytes).not.toContain(contents)
  })
})
