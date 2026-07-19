import { existsSync, fstatSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    close: vi.fn(actual.close)
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return {
    ...actual,
    open: vi.fn(actual.open),
    lstat: vi.fn(actual.lstat),
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink)
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

function observeOpenedFileHandles(configure: (handle: FileHandle, index: number) => void = () => undefined) {
  const handles: FileHandle[] = []
  const open = vi.mocked(fsPromises.open)
  const actualOpen = open.getMockImplementation()
  if (actualOpen === undefined) throw new Error('Expected the real async open implementation')
  open.mockImplementation(async (...args) => {
    const handle = await actualOpen(...args)
    const index = handles.length
    handles.push(handle)
    configure(handle, index)
    return handle
  })
  return handles
}

let testDir = ''

beforeEach(async () => {
  vi.clearAllMocks()
  const actualFs = await vi.importActual<typeof fs>('node:fs')
  const actualFsPromises = await vi.importActual<typeof fsPromises>('node:fs/promises')
  vi.mocked(fs.close).mockImplementation(actualFs.close)
  vi.mocked(fsPromises.open).mockImplementation(actualFsPromises.open)
  vi.mocked(fsPromises.lstat).mockImplementation(actualFsPromises.lstat)
  vi.mocked(fsPromises.rename).mockImplementation(actualFsPromises.rename)
  vi.mocked(fsPromises.unlink).mockImplementation(actualFsPromises.unlink)
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-bundle-unit-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('strict bundle schemas and accounting', () => {
  it('copies a validated upgrade-path block context into migration-events.json', async () => {
    const attemptId = 'version-block-private-attempt-id'
    const versionGate = {
      reason: 'v1_too_old',
      currentVersion: '2.0.0',
      previousVersion: '1.8.0',
      requiredVersion: '1.9.12',
      gatewayVersion: null,
      versionLog: 'present'
    } as const
    const snapshot = {
      version: 1,
      sessionId: 'version-block-private-session-id',
      appVersion: '2.0.0-beta.1+private',
      platform: 'darwin',
      arch: 'arm64',
      startedAt: STARTED_AT,
      state: 'active',
      attempts: [
        {
          id: attemptId,
          trigger: 'initial',
          startedAt: STARTED_AT,
          outcome: 'in_progress',
          events: [
            {
              sequence: 1,
              at: STARTED_AT,
              attemptId,
              scope: 'gate',
              phase: 'validate',
              state: 'unavailable',
              code: 'upgrade_path_blocked',
              versionGate
            }
          ]
        }
      ]
    } as unknown as MigrationDiagnosticsSession
    const destination = path.join(testDir, 'version-block.zip')

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot,
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    const entries = await readZip(destination)
    const events = migrationDiagnosticEventsDocumentSchema.parse(parseJson(entries, 'migration-events.json'))
    expect(events.session.appVersion).toBe('2.0.0')
    expect(events.attempts[0]?.events[0]).toMatchObject({ code: 'upgrade_path_blocked', versionGate })
    expect(JSON.stringify(events)).not.toContain('private-session-id')
    expect(JSON.stringify(events)).not.toContain('private-attempt-id')
    expect(JSON.stringify(events)).not.toContain('beta.1+private')
  })

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

  it('rejects manifest component statuses that disagree with their truncation counters', async () => {
    const destination = path.join(testDir, 'manifest-cross-fields.zip')
    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })
    expect(result.status).toBe('saved')
    const entries = await readZip(destination)
    const manifest = migrationDiagnosticManifestSchema.parse(parseJson(entries, 'manifest.json'))

    const invalidCandidates = [
      {
        ...manifest,
        components: { ...manifest.components, migrationEvents: { status: 'complete' as const } },
        truncation: { ...manifest.truncation, droppedIntermediateEvents: 1 }
      },
      {
        ...manifest,
        components: { ...manifest.components, migrationEvents: { status: 'truncated' as const } },
        truncation: { ...manifest.truncation, droppedIntermediateEvents: 0 }
      },
      {
        ...manifest,
        components: {
          ...manifest.components,
          databaseDiagnostics: { ...manifest.components.databaseDiagnostics, details: 'complete' as const }
        },
        truncation: { ...manifest.truncation, omittedDatabaseDetails: ['l2' as const] }
      },
      {
        ...manifest,
        components: {
          ...manifest.components,
          databaseDiagnostics: { ...manifest.components.databaseDiagnostics, details: 'truncated' as const }
        },
        truncation: { ...manifest.truncation, omittedDatabaseDetails: [] }
      }
    ]

    for (const candidate of invalidCandidates) {
      expect(migrationDiagnosticManifestSchema.safeParse(candidate).success).toBe(false)
    }
  })

  it('requires generated attempt IDs to match their exact ordered ordinals', async () => {
    const destination = path.join(testDir, 'attempt-ordinals.zip')
    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })
    expect(result.status).toBe('saved')
    const entries = await readZip(destination)
    const events = migrationDiagnosticEventsDocumentSchema.parse(parseJson(entries, 'migration-events.json'))
    const manifest = migrationDiagnosticManifestSchema.parse(parseJson(entries, 'manifest.json'))

    expect(
      migrationDiagnosticEventsDocumentSchema.safeParse({
        ...events,
        attempts: events.attempts.map((attempt) => ({ ...attempt, id: 'attempt-2' }))
      }).success
    ).toBe(false)
    expect(
      migrationDiagnosticManifestSchema.safeParse({
        ...manifest,
        session: {
          ...manifest.session,
          attempts: manifest.session.attempts.map((attempt) => ({ ...attempt, id: 'attempt-2' }))
        }
      }).success
    ).toBe(false)
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
    const stringify = vi.spyOn(JSON, 'stringify')
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
    for (const [destinationIndex, destination] of destinations.entries()) {
      const startedAt = performance.now()
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot,
        collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
      })
      expect(result.status).toBe('saved')
      if (destinationIndex === 0) {
        const selectionSerializations = stringify.mock.calls.filter(([value]) => {
          if (typeof value !== 'object' || value === null) return false
          return 'attempts' in value || 'diagnosticVersion' in value || ('policy' in value && value.policy === 'strict')
        })
        expect(selectionSerializations.length).toBeLessThanOrEqual(80)
        expect(performance.now() - startedAt).toBeLessThan(1_500)
        stringify.mockClear()
      }
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
    expect(vi.mocked(fsPromises.open)).not.toHaveBeenCalled()
  })

  it('keeps the event loop responsive while delayed asynchronous file I/O is pending', async () => {
    const destination = path.join(testDir, 'async-responsive.zip')
    const open = vi.mocked(fsPromises.open)
    const actualOpen = open.getMockImplementation()
    if (actualOpen === undefined) throw new Error('Expected the real async open implementation')
    let delayedOpenObserved = false
    open.mockImplementationOnce(async (...args) => {
      delayedOpenObserved = true
      await new Promise((resolve) => setTimeout(resolve, 30))
      return actualOpen(...args)
    })
    let timerTicks = 0
    const timer = setInterval(() => {
      timerTicks += 1
    }, 1)
    const startedAt = performance.now()

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })
    clearInterval(timer)

    expect(result.status).toBe('saved')
    expect(delayedOpenObserved).toBe(true)
    expect(timerTicks).toBeGreaterThanOrEqual(2)
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(20)
  })

  it('does not unlink a replacement that appears while its owned partial is being validated', async () => {
    const destination = path.join(testDir, 'replacement-race.zip')
    const partial = `${destination}.partial`
    const replacement = Buffer.from('UNOWNED_REPLACEMENT')
    const open = vi.mocked(fsPromises.open)
    const actualOpen = open.getMockImplementation()
    if (actualOpen === undefined) throw new Error('Expected the real async open implementation')
    open.mockImplementationOnce((...args) => actualOpen(...args))
    open.mockImplementationOnce(async (...args) => {
      const handle = await actualOpen(...args)
      const actualReadFile = handle.readFile.bind(handle)
      vi.spyOn(handle, 'readFile').mockImplementationOnce(async () => {
        const original = await actualReadFile()
        rmSync(partial)
        writeFileSync(partial, replacement, { mode: 0o600 })
        return original
      })
      return handle
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect.soft(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
    expect.soft(existsSync(destination)).toBe(false)
    expect.soft(existsSync(partial)).toBe(true)
    if (existsSync(partial)) expect(readFileSync(partial)).toEqual(replacement)
  })

  it('requires the node-stream validation reader to close successfully', async () => {
    const destination = path.join(testDir, 'stream-close.zip')
    const close = vi.mocked(fs.close)
    const actualClose = close.getMockImplementation()
    if (actualClose === undefined) throw new Error('Expected the real async descriptor close implementation')
    close.mockImplementationOnce(((_fd: number, callback: (error?: NodeJS.ErrnoException | null) => void) => {
      callback(new Error('RAW_CLOSE_PRIVATE_ERROR'))
    }) as typeof fs.close)
    vi.spyOn(StreamZip.async.prototype, 'close').mockRejectedValueOnce(new Error('STREAM_CLOSE_PRIVATE_ERROR'))

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
    expect(JSON.stringify(result)).not.toMatch(/STREAM_CLOSE_PRIVATE_ERROR|RAW_CLOSE_PRIVATE_ERROR/)
    expect(close).toHaveBeenCalledTimes(2)
    const validationFd = close.mock.calls[0]?.[0]
    if (validationFd === undefined) throw new Error('Expected an owned validation descriptor')
    expect(() => fstatSync(validationFd)).toThrow()
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it.each([
    ['write', 1, 'publish_failed', 'not_published'],
    ['read', 2, 'archive_failed', 'not_published'],
    ['directory', 3, 'publish_failed', 'published']
  ] as const)(
    'reports a fixed result when the asynchronous %s handle close fails',
    async (label, failingOpenOrdinal, code, publication) => {
      if (label === 'directory' && process.platform === 'win32') return
      const destination = path.join(testDir, `async-${label}-close.zip`)
      const open = vi.mocked(fsPromises.open)
      const actualOpen = open.getMockImplementation()
      if (actualOpen === undefined) throw new Error('Expected the real async open implementation')
      let failingHandle: FileHandle | undefined
      for (let ordinal = 1; ordinal <= failingOpenOrdinal; ordinal += 1) {
        open.mockImplementationOnce(async (...args) => {
          const handle = await actualOpen(...args)
          if (ordinal === failingOpenOrdinal) {
            failingHandle = handle
            const actualClose = handle.close.bind(handle)
            vi.spyOn(handle, 'close')
              .mockRejectedValueOnce(new Error(`${label.toUpperCase()}_CLOSE_PRIVATE_ERROR`))
              .mockImplementationOnce(actualClose)
          }
          return handle
        })
      }

      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot: failedSnapshot(),
        collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
      })

      expect(result).toEqual({ status: 'failed', code, publication })
      expect(JSON.stringify(result)).not.toContain('CLOSE_PRIVATE_ERROR')
      expect(existsSync(destination)).toBe(publication === 'published')
      if (publication === 'published') expect(existsSync(`${destination}.partial`)).toBe(false)
      if (failingHandle === undefined) throw new Error('Expected a failing handle')
      expect(failingHandle.close).toHaveBeenCalledTimes(2)
      await expect(failingHandle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'uses exact .partial + 0600 and file fsync -> rename -> POSIX directory fsync',
    async () => {
      const destination = path.join(testDir, 'atomic.zip')
      const handles = observeOpenedFileHandles((handle) => {
        vi.spyOn(handle, 'write')
        vi.spyOn(handle, 'sync')
        vi.spyOn(handle, 'close')
      })
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot: failedSnapshot(),
        collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
      })

      expect(result.status).toBe('saved')
      const open = vi.mocked(fsPromises.open)
      const rename = vi.mocked(fsPromises.rename)
      const writeHandle = handles[0]
      const readHandle = handles[1]
      const directoryHandle = handles[2]
      if (writeHandle === undefined || readHandle === undefined || directoryHandle === undefined) {
        throw new Error('Expected write, read, and directory handles')
      }
      const write = vi.mocked(writeHandle.write)
      const fileSync = vi.mocked(writeHandle.sync)
      const writeClose = vi.mocked(writeHandle.close)
      const readClose = vi.mocked(readHandle.close)
      const directorySync = vi.mocked(directoryHandle.sync)
      const partial = `${destination}.partial`
      expect(open.mock.calls[0]).toEqual([partial, 'wx', 0o600])
      expect(open.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
      expect(write.mock.invocationCallOrder[0]).toBeLessThan(fileSync.mock.invocationCallOrder[0])
      expect(fileSync.mock.invocationCallOrder[0]).toBeLessThan(writeClose.mock.invocationCallOrder[0])
      expect(writeClose.mock.invocationCallOrder[0]).toBeLessThan(readClose.mock.invocationCallOrder[0])
      expect(readClose.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0])
      expect(rename).toHaveBeenCalledWith(partial, destination)
      expect(open.mock.calls.at(-1)).toEqual([testDir, 'r'])
      expect(rename.mock.invocationCallOrder[0]).toBeLessThan(directorySync.mock.invocationCallOrder[0])
      if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o600)
      expect(existsSync(partial)).toBe(false)
    }
  )

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
    const handles = observeOpenedFileHandles((handle, index) => {
      if (index !== 0) return
      const actualWrite = handle.write.bind(handle)
      vi.spyOn(handle, 'write').mockImplementationOnce((async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number
      ) => actualWrite(buffer, offset, Math.max(1, Math.floor(length / 2)), position)) as FileHandle['write'])
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    const writeHandle = handles[0]
    if (writeHandle === undefined) throw new Error('Expected a write handle')
    expect(vi.mocked(writeHandle.write).mock.calls.length).toBeGreaterThan(1)
    expect(readFileSync(destination).subarray(0, 2).toString()).toBe('PK')
  })

  it('treats a zero-byte write as a publication failure and removes its owned partial', async () => {
    const destination = path.join(testDir, 'zero-write.zip')
    observeOpenedFileHandles((handle, index) => {
      if (index !== 0) return
      vi.spyOn(handle, 'write').mockImplementationOnce((async (buffer: Buffer) => ({
        bytesWritten: 0,
        buffer
      })) as FileHandle['write'])
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.partial`)).toBe(false)
  })

  it.each(['write', 'file fsync', 'rename'] as const)(
    'keeps the old destination and removes its owned partial on %s failure',
    async (label) => {
      const destination = path.join(testDir, `failure-${label}.zip`)
      writeFileSync(destination, 'old-content')
      let writeFailureHandle: FileHandle | undefined
      if (label === 'rename') {
        vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error('RENAME_SECRET'))
      } else {
        observeOpenedFileHandles((handle, index) => {
          if (index !== 0) return
          if (label === 'write') {
            writeFailureHandle = handle
            const actualClose = handle.close.bind(handle)
            vi.spyOn(handle, 'write').mockRejectedValueOnce(new Error('WRITE_SECRET'))
            vi.spyOn(handle, 'close')
              .mockRejectedValueOnce(new Error('WRITE_CLOSE_PRIVATE_ERROR'))
              .mockImplementationOnce(actualClose)
          } else {
            vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('FSYNC_SECRET'))
          }
        })
      }

      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot: failedSnapshot(),
        collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
      })

      expect(result).toEqual({ status: 'failed', code: 'publish_failed', publication: 'not_published' })
      expect(JSON.stringify(result)).not.toMatch(/WRITE_SECRET|FSYNC_SECRET|RENAME_SECRET/)
      expect(readFileSync(destination, 'utf8')).toBe('old-content')
      expect(existsSync(`${destination}.partial`)).toBe(false)
      if (label === 'write') {
        if (writeFailureHandle === undefined) throw new Error('Expected the write failure handle')
        expect(writeFailureHandle.close).toHaveBeenCalledTimes(2)
        await expect(writeFailureHandle.stat()).rejects.toMatchObject({ code: 'EBADF' })
      }
    }
  )

  it('reports a directory-fsync failure as already published and never rolls the archive back', async () => {
    const destination = path.join(testDir, 'dir-fsync.zip')
    if (process.platform === 'win32') return
    observeOpenedFileHandles((handle, index) => {
      if (index === 2) vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('DIR_FSYNC_PRIVATE_ERROR'))
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
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

  it.skipIf(process.platform !== 'win32')('skips directory fsync on Windows while keeping file fsync', async () => {
    const destination = path.join(testDir, 'windows.zip')
    const handles = observeOpenedFileHandles((handle) => {
      vi.spyOn(handle, 'sync')
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => failedDatabaseDiagnostics()
    })

    expect(result.status).toBe('saved')
    expect(handles).toHaveLength(2)
    const writeHandle = handles[0]
    if (writeHandle === undefined) throw new Error('Expected a write handle')
    expect(vi.mocked(writeHandle.sync)).toHaveBeenCalledTimes(1)
  })
})
