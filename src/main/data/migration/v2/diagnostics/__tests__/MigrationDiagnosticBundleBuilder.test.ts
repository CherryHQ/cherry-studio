import fs, {
  existsSync,
  fsyncSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync as actualWriteSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    default: {
      ...actual,
      openSync: vi.fn(actual.openSync),
      writeSync: vi.fn(actual.writeSync),
      fsyncSync: vi.fn(actual.fsyncSync),
      closeSync: vi.fn(actual.closeSync),
      renameSync: vi.fn(actual.renameSync),
      unlinkSync: vi.fn(actual.unlinkSync)
    }
  }
})

import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  type MigrationDatabaseColumnCountBucket,
  type MigrationDatabaseCompletedDiagnosticResult,
  type MigrationDatabaseDiagnosticResult
} from '../migrationDatabaseDiagnosticsSchemas'
import {
  assertStrictMigrationDiagnosticUncompressedBudget,
  createMigrationDatabaseDiagnosticsDocument,
  MIGRATION_DIAGNOSTIC_STRICT_ENTRIES,
  MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder,
  omitNextMigrationDatabaseDiagnosticDetails
} from '../MigrationDiagnosticBundleBuilder'
import {
  migrationDatabaseDiagnosticsDocumentSchema,
  migrationDiagnosticEventsDocumentSchema,
  migrationDiagnosticManifestSchema
} from '../migrationDiagnosticBundleSchemas'
import type { MigrationDiagnosticsSession, PayloadLengthProfile } from '../migrationDiagnosticsSchemas'

const STARTED_AT = '2026-07-19T10:00:00.000Z'
const ENDED_AT = '2026-07-19T10:01:00.000Z'

function failedDatabaseDiagnostics(): MigrationDatabaseDiagnosticResult {
  return {
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'failed', code: 'lease_unavailable' }
  }
}

function bucketColumnCount(count: number | undefined): MigrationDatabaseColumnCountBucket {
  if (count === undefined) return 'unavailable'
  if (count === 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

function completedDatabaseDiagnostics(): MigrationDatabaseCompletedDiagnosticResult {
  return {
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'completed' },
    l0: {
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
    },
    l1: {
      level: 'l1',
      status: 'success',
      data: {
        metadata: {
          pageSize: '4096',
          encoding: 'utf8',
          userVersionBucket: '0',
          schemaVersionBucket: '1_to_10',
          applicationId: 'unset',
          queryOnly: true
        },
        objects: EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => ({
          id: object.id,
          kind: object.kind,
          status: 'ok' as const,
          columnCountBucket: bucketColumnCount('columnCount' in object ? object.columnCount : undefined)
        })),
        unknownObjects: []
      }
    },
    l2: {
      level: 'l2',
      status: 'success',
      data: {
        quickCheck: { outcome: 'ok', issueCountBucket: '0', categories: [], truncated: false },
        foreignKeys: { outcome: 'ok', scannedCountBucket: '0', violations: [], truncated: false }
      }
    }
  }
}

function terminalEvent(attemptId: string, sequence = 2) {
  return {
    sequence,
    at: ENDED_AT,
    attemptId,
    scope: 'engine' as const,
    phase: 'finalize' as const,
    state: 'failed' as const,
    code: 'sqlite_too_big' as const,
    category: 'database_write' as const,
    causeDepth: 1
  }
}

function failedSnapshot(overrides: Partial<MigrationDiagnosticsSession> = {}): MigrationDiagnosticsSession {
  const attemptId = 'source-attempt-private-id'
  return {
    version: 1,
    sessionId: 'source-session-private-id',
    appVersion: '2.0.0-test+private',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: STARTED_AT,
    state: 'failed',
    attempts: [
      {
        id: attemptId,
        trigger: 'initial',
        startedAt: STARTED_AT,
        outcome: 'failed',
        endedAt: ENDED_AT,
        events: [terminalEvent(attemptId)]
      }
    ],
    ...overrides
  }
}

async function readZip(file: string): Promise<Map<string, Buffer>> {
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const buffers = new Map<string, Buffer>()
    for (const name of Object.keys(entries)) {
      buffers.set(name, await zip.entryData(name))
    }
    return buffers
  } finally {
    await zip.close()
  }
}

function parseJson<T>(entries: Map<string, Buffer>, name: string): T {
  const entry = entries.get(name)
  if (entry === undefined) throw new Error(`Missing test entry: ${name}`)
  return JSON.parse(entry.toString('utf8')) as T
}

let testDir = ''

beforeEach(() => {
  vi.clearAllMocks()
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-bundle-unit-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('strict bundle schemas and accounting', () => {
  it('rejects unknown keys in every generated structured document', async () => {
    const destination = path.join(testDir, 'diagnostics.zip')
    const builder = new MigrationDiagnosticBundleBuilder()
    const snapshot = {
      ...failedSnapshot(),
      rawError: 'UNKNOWN_KEY_CANARY_should_not_escape'
    } as MigrationDiagnosticsSession

    const result = await builder.save({
      destination,
      snapshot,
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'invalid_input', publication: 'not_published' })
    expect(JSON.stringify(result)).not.toContain('UNKNOWN_KEY_CANARY')
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)

    expect(migrationDiagnosticEventsDocumentSchema.safeParse({ formatVersion: 1, leaked: true }).success).toBe(false)
    expect(migrationDatabaseDiagnosticsDocumentSchema.safeParse({ formatVersion: 1, leaked: true }).success).toBe(false)
    expect(migrationDiagnosticManifestSchema.safeParse({ formatVersion: 1, leaked: true }).success).toBe(false)
  })

  it('accepts the exact 1 MiB boundary and rejects one additional UTF-8 byte', () => {
    const exact = [Buffer.alloc(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES - 3), Buffer.from('中', 'utf8')]
    expect(assertStrictMigrationDiagnosticUncompressedBudget(exact)).toBe(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)
    expect(() => assertStrictMigrationDiagnosticUncompressedBudget([...exact, Buffer.from('x')])).toThrow(
      'budget_exceeded'
    )
  })

  it('rejects a nonterminal event after a terminal event and out-of-order sequences', async () => {
    const builder = new MigrationDiagnosticBundleBuilder()
    const attempt = failedSnapshot().attempts[0]
    if (attempt === undefined || attempt.outcome !== 'failed') throw new Error('Expected a failed attempt fixture')
    const afterTerminal = {
      ...failedSnapshot(),
      attempts: [
        {
          ...attempt,
          events: [
            terminalEvent(attempt.id, 2),
            {
              ...terminalEvent(attempt.id, 3),
              state: 'started' as const,
              code: 'unknown' as const
            }
          ]
        }
      ]
    }
    const outOfOrder = {
      ...failedSnapshot(),
      attempts: [{ ...attempt, events: [terminalEvent(attempt.id, 3), terminalEvent(attempt.id, 2)] }]
    }

    for (const [index, snapshot] of [afterTerminal, outOfOrder].entries()) {
      const destination = path.join(testDir, `invalid-terminal-${index}.zip`)
      await expect(
        builder.save({
          destination,
          snapshot,
          collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
        })
      ).resolves.toEqual({ status: 'failed', code: 'invalid_input', publication: 'not_published' })
      expect(existsSync(`${destination}.partial`)).toBe(false)
    }
  })

  it('requires terminal timestamp/outcome/code semantics instead of trusting the last event', async () => {
    const builder = new MigrationDiagnosticBundleBuilder()
    const completedAttempt = {
      id: 'attempt-completed',
      trigger: 'initial' as const,
      startedAt: STARTED_AT,
      outcome: 'completed' as const,
      endedAt: ENDED_AT,
      events: [
        {
          ...terminalEvent('attempt-completed'),
          state: 'completed' as const,
          code: 'disk_full' as const
        }
      ]
    }
    const snapshot: MigrationDiagnosticsSession = {
      ...failedSnapshot(),
      state: 'completed',
      attempts: [completedAttempt]
    }

    const result = await builder.save({
      destination: path.join(testDir, 'invalid-code.zip'),
      snapshot,
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'invalid_input', publication: 'not_published' })
  })
})

describe('strict bundle manifest and deterministic selection', () => {
  it('iterates manifest serialization to a self-consistent byte fixed point', async () => {
    const destination = path.join(testDir, 'fixed-point.zip')
    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    const entries = await readZip(destination)
    const manifest = migrationDiagnosticManifestSchema.parse(parseJson(entries, 'manifest.json'))
    const recorded = new Map(manifest.entries.map((entry) => [entry.name, entry.uncompressedBytes]))
    for (const name of MIGRATION_DIAGNOSTIC_STRICT_ENTRIES) {
      expect(recorded.get(name)).toBe(entries.get(name)?.byteLength)
    }
    expect(manifest.totalUncompressedBytes).toBe(
      [...entries.values()].reduce((total, entry) => total + entry.byteLength, 0)
    )
    expect(manifest.totalUncompressedBytes).toBeLessThanOrEqual(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)
    expect(entries.get('README.txt')?.byteLength).toBeGreaterThan(
      entries.get('README.txt')?.toString('utf8').length ?? 0
    )
    expect(Buffer.from(JSON.stringify(manifest), 'utf8').byteLength).toBe(entries.get('manifest.json')?.byteLength)
  })

  it('drops the oldest intermediate events deterministically and retains every true terminal event', async () => {
    const maximumProfile: PayloadLengthProfile = {
      target: 'message',
      rowCountBucket: '101-1000',
      profiledByteLengthBucket: '262145+',
      maxProfiledRowByteLengthBucket: '262145+',
      traversal: 'truncated',
      slots: Array.from({ length: 64 }, () => ({
        slot: 'content' as const,
        kind: 'json' as const,
        totalSerializedByteLengthBucket: '262145+' as const,
        maxSerializedByteLengthBucket: '262145+' as const,
        maxStringLeafCharLengthBucket: '262145+' as const,
        maxStringLeafByteLengthBucket: '262145+' as const,
        traversal: 'truncated' as const
      }))
    }
    let sequence = 0
    const attempts = Array.from({ length: 5 }, (_, attemptIndex) => {
      const id = `private-attempt-${attemptIndex}`
      const events = Array.from({ length: 39 }, () => ({
        sequence: ++sequence,
        at: STARTED_AT,
        attemptId: id,
        scope: 'migrator' as const,
        phase: 'execute' as const,
        state: 'started' as const,
        code: 'unknown' as const,
        migratorId: 'chat',
        payloadProfile: maximumProfile
      }))
      events.push({
        ...terminalEvent(id, ++sequence),
        at: ENDED_AT,
        migratorId: 'chat',
        payloadProfile: maximumProfile
      } as unknown as (typeof events)[number])
      return {
        id,
        trigger: attemptIndex === 0 ? ('initial' as const) : ('manual_retry' as const),
        startedAt: STARTED_AT,
        outcome: 'failed' as const,
        endedAt: ENDED_AT,
        events
      }
    })
    const snapshot: MigrationDiagnosticsSession = {
      ...failedSnapshot(),
      attempts
    }
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeGreaterThan(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)

    const destinations = [path.join(testDir, 'truncate-a.zip'), path.join(testDir, 'truncate-b.zip')]
    for (const destination of destinations) {
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot,
        collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
      })
      expect(result.status).toBe('saved')
    }

    const first = await readZip(destinations[0])
    const second = await readZip(destinations[1])
    expect(first.get('migration-events.json')).toEqual(second.get('migration-events.json'))
    expect(first.get('database-diagnostics.json')).toEqual(second.get('database-diagnostics.json'))
    const eventsDocument = migrationDiagnosticEventsDocumentSchema.parse(parseJson(first, 'migration-events.json'))
    const manifest = migrationDiagnosticManifestSchema.parse(parseJson(first, 'manifest.json'))
    const retained = eventsDocument.attempts.flatMap((attempt) => attempt.events)
    expect(manifest.components.migrationEvents.status).toBe('truncated')
    expect(manifest.truncation.droppedIntermediateEvents).toBeGreaterThan(0)
    expect(retained.map((event) => event.sequence)).not.toContain(1)
    expect(retained.map((event) => event.sequence)).toEqual(
      [...retained.map((event) => event.sequence)].sort((left, right) => left - right)
    )
    expect(eventsDocument.attempts.map((attempt) => attempt.events.at(-1)?.sequence)).toEqual([40, 80, 120, 160, 200])
  })

  it('omits optional database details in the fixed l2 -> l1 -> l0 order without dropping statuses', () => {
    const document = createMigrationDatabaseDiagnosticsDocument(completedDatabaseDiagnostics())

    const l2Omitted = omitNextMigrationDatabaseDiagnosticDetails(document)
    const l1Omitted = l2Omitted === null ? null : omitNextMigrationDatabaseDiagnosticDetails(l2Omitted)
    const l0Omitted = l1Omitted === null ? null : omitNextMigrationDatabaseDiagnosticDetails(l1Omitted)

    expect(l2Omitted?.levels.l2?.details.status).toBe('omitted_for_size')
    expect(l2Omitted?.levels.l1?.details.status).toBe('included')
    expect(l1Omitted?.levels.l1?.details.status).toBe('omitted_for_size')
    expect(l0Omitted?.levels.l0?.details.status).toBe('omitted_for_size')
    expect(l0Omitted?.levels.l2?.status).toBe('success')
    expect(l0Omitted?.completion).toEqual({ status: 'completed' })
    expect(l0Omitted === null ? null : omitNextMigrationDatabaseDiagnosticDetails(l0Omitted)).toBeNull()
  })
})

describe('strict bundle publication', () => {
  it('rejects a filesystem root destination without creating a partial', async () => {
    const destination = path.parse(testDir).root

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'invalid_input', publication: 'not_published' })
    expect(existsSync(`${destination}.partial`)).toBe(false)
    expect(vi.mocked(fs.openSync)).not.toHaveBeenCalled()
  })

  it('uses exact .partial + 0600 and file fsync -> rename -> POSIX directory fsync', async () => {
    const destination = path.join(testDir, 'atomic.zip')
    const result = await new MigrationDiagnosticBundleBuilder({ platform: 'darwin' }).save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    const open = vi.mocked(fs.openSync)
    const write = vi.mocked(fs.writeSync)
    const fsync = vi.mocked(fs.fsyncSync)
    const close = vi.mocked(fs.closeSync)
    const rename = vi.mocked(fs.renameSync)
    const partial = `${destination}.partial`
    expect(open.mock.calls[0]).toEqual([partial, 'wx', 0o600])
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(fsync.mock.invocationCallOrder[0])
    expect(fsync.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0])
    expect(rename).toHaveBeenCalledWith(partial, destination)
    expect(open.mock.calls.at(-1)).toEqual([testDir, 'r'])
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(fsync.mock.invocationCallOrder.at(-1) ?? 0)
    if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o600)
    expect(existsSync(partial)).toBe(false)
  })

  it('atomically replaces an existing destination only after a complete archive is ready', async () => {
    const destination = path.join(testDir, 'replace.zip')
    writeFileSync(destination, 'old-diagnostic-content', { mode: 0o644 })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    expect(readFileSync(destination).subarray(0, 2).toString()).toBe('PK')
    if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o600)
  })

  it('continues writing from the returned offset after a short write', async () => {
    const destination = path.join(testDir, 'short-write.zip')
    const write = vi.mocked(fs.writeSync)
    const shortWrite = (fd: number, buffer: Uint8Array, offset: number, length: number): number =>
      actualWriteSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2)))
    write.mockImplementationOnce(shortWrite as typeof fs.writeSync)

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    expect(write.mock.calls.length).toBeGreaterThan(1)
    expect(readFileSync(destination).subarray(0, 2).toString()).toBe('PK')
  })

  it('treats a zero-byte write as a publication failure and removes its owned partial', async () => {
    const destination = path.join(testDir, 'zero-write.zip')
    vi.mocked(fs.writeSync).mockImplementationOnce(() => 0)

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it.each([
    [
      'write',
      () =>
        vi.mocked(fs.writeSync).mockImplementationOnce(() => {
          throw new Error('WRITE_SECRET')
        })
    ],
    [
      'file fsync',
      () =>
        vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
          throw new Error('FSYNC_SECRET')
        })
    ],
    [
      'rename',
      () =>
        vi.mocked(fs.renameSync).mockImplementationOnce(() => {
          throw new Error('RENAME_SECRET')
        })
    ]
  ])('keeps the old destination and removes its owned partial on %s failure', async (_label, injectFailure) => {
    const destination = path.join(testDir, `failure-${_label}.zip`)
    writeFileSync(destination, 'old-content')
    injectFailure()

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
    expect(JSON.stringify(result)).not.toMatch(/WRITE_SECRET|FSYNC_SECRET|RENAME_SECRET/)
    expect(readFileSync(destination, 'utf8')).toBe('old-content')
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it('reports a directory-fsync failure as already published and never rolls the archive back', async () => {
    const destination = path.join(testDir, 'dir-fsync.zip')
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error('DIR_FSYNC_PRIVATE_ERROR')
      })

    const result = await new MigrationDiagnosticBundleBuilder({ platform: 'darwin' }).save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'published' })
    expect(JSON.stringify(result)).not.toContain('DIR_FSYNC_PRIVATE_ERROR')
    expect(readFileSync(destination).subarray(0, 2).toString()).toBe('PK')
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it('uses the existing exact partial as an exclusive conflict and does not disturb it', async () => {
    const destination = path.join(testDir, 'conflict.zip')
    const partial = `${destination}.partial`
    writeFileSync(partial, 'other-save-in-progress', { mode: 0o600 })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
    expect(readFileSync(partial, 'utf8')).toBe('other-save-in-progress')
    expect(existsSync(destination)).toBe(false)
  })

  it('skips directory fsync on Windows while keeping file fsync', async () => {
    const destination = path.join(testDir, 'windows.zip')

    const result = await new MigrationDiagnosticBundleBuilder({ platform: 'win32' }).save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    expect(vi.mocked(fs.fsyncSync)).toHaveBeenCalledTimes(1)
  })
})
