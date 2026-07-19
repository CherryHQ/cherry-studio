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

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

interface ProductionZipEntryLayout {
  readonly centralOffset: number
  readonly localOffset: number
  readonly nameLength: number
}

interface ProductionZipLayout {
  readonly centralOffset: number
  readonly centralSize: number
  readonly eocdOffset: number
  readonly entries: readonly ProductionZipEntryLayout[]
}

function parseProductionZipLayout(archive: Buffer): ProductionZipLayout {
  const eocdOffset = archive.byteLength - 22
  if (eocdOffset < 0 || archive.readUInt32LE(eocdOffset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error('Expected the production archive to end with an ordinary EOCD')
  }
  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  const centralSize = archive.readUInt32LE(eocdOffset + 12)
  const centralOffset = archive.readUInt32LE(eocdOffset + 16)
  const entries: ProductionZipEntryLayout[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error('Expected a contiguous production central directory')
    }
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    entries.push({ centralOffset: cursor, localOffset: archive.readUInt32LE(cursor + 42), nameLength })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== centralOffset + centralSize) throw new Error('Expected exact production central directory size')
  return { centralOffset, centralSize, eocdOffset, entries }
}

function insertBeforeCentral(
  archive: Buffer,
  insertionOffset: number,
  addition: Buffer,
  shiftLocalOffsetsAtOrAfter: number
): Buffer {
  const layout = parseProductionZipLayout(archive)
  const mutated = Buffer.concat([archive.subarray(0, insertionOffset), addition, archive.subarray(insertionOffset)])
  const delta = addition.byteLength
  for (const entry of layout.entries) {
    const shiftedCentralOffset = entry.centralOffset + delta
    const shiftedLocalOffset =
      entry.localOffset >= shiftLocalOffsetsAtOrAfter ? entry.localOffset + delta : entry.localOffset
    mutated.writeUInt32LE(shiftedLocalOffset, shiftedCentralOffset + 42)
  }
  mutated.writeUInt32LE(layout.centralOffset + delta, layout.eocdOffset + delta + 16)
  return mutated
}

function removeBeforeCentral(archive: Buffer, removalOffset: number, removalLength: number): Buffer {
  const layout = parseProductionZipLayout(archive)
  const removalEnd = removalOffset + removalLength
  const mutated = Buffer.concat([archive.subarray(0, removalOffset), archive.subarray(removalEnd)])
  for (const entry of layout.entries) {
    const shiftedCentralOffset = entry.centralOffset - removalLength
    const shiftedLocalOffset = entry.localOffset >= removalEnd ? entry.localOffset - removalLength : entry.localOffset
    mutated.writeUInt32LE(shiftedLocalOffset, shiftedCentralOffset + 42)
  }
  mutated.writeUInt32LE(layout.centralOffset - removalLength, layout.eocdOffset - removalLength + 16)
  return mutated
}

function addLocalExtra(archive: Buffer): Buffer {
  const layout = parseProductionZipLayout(archive)
  const first = layout.entries[0]
  if (first === undefined || archive.readUInt32LE(first.localOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('Expected the first production local header')
  }
  const localNameLength = archive.readUInt16LE(first.localOffset + 26)
  const insertionOffset = first.localOffset + 30 + localNameLength
  const extra = Buffer.from([0xfe, 0xca, 0x00, 0x00])
  const mutated = insertBeforeCentral(archive, insertionOffset, extra, insertionOffset)
  mutated.writeUInt16LE(extra.byteLength, first.localOffset + 28)
  return mutated
}

function addCentralMetadata(archive: Buffer, kind: 'extra' | 'comment'): Buffer {
  const layout = parseProductionZipLayout(archive)
  const first = layout.entries[0]
  if (first === undefined) throw new Error('Expected a production central entry')
  const addition = kind === 'extra' ? Buffer.from([0xfe, 0xca, 0x00, 0x00]) : Buffer.from('comment')
  const insertionOffset = first.centralOffset + 46 + first.nameLength
  const mutated = Buffer.concat([archive.subarray(0, insertionOffset), addition, archive.subarray(insertionOffset)])
  mutated.writeUInt16LE(addition.byteLength, first.centralOffset + (kind === 'extra' ? 30 : 32))
  mutated.writeUInt32LE(layout.centralSize + addition.byteLength, layout.eocdOffset + addition.byteLength + 12)
  return mutated
}

function addUnnecessaryZip64Region(archive: Buffer): Buffer {
  const layout = parseProductionZipLayout(archive)
  const zip64Eocd = Buffer.alloc(56)
  zip64Eocd.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  zip64Eocd.writeBigUInt64LE(44n, 4)
  zip64Eocd.writeUInt16LE(45, 12)
  zip64Eocd.writeUInt16LE(45, 14)
  zip64Eocd.writeBigUInt64LE(BigInt(layout.entries.length), 24)
  zip64Eocd.writeBigUInt64LE(BigInt(layout.entries.length), 32)
  zip64Eocd.writeBigUInt64LE(BigInt(layout.centralSize), 40)
  zip64Eocd.writeBigUInt64LE(BigInt(layout.centralOffset), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE, 0)
  locator.writeBigUInt64LE(BigInt(layout.eocdOffset), 8)
  locator.writeUInt32LE(1, 16)
  return Buffer.concat([
    archive.subarray(0, layout.eocdOffset),
    zip64Eocd,
    locator,
    archive.subarray(layout.eocdOffset)
  ])
}

function addAdjustedPrefix(archive: Buffer): Buffer {
  const layout = parseProductionZipLayout(archive)
  const prefix = Buffer.from('SFX!')
  const mutated = Buffer.concat([prefix, archive])
  for (const entry of layout.entries) {
    mutated.writeUInt32LE(entry.localOffset + prefix.byteLength, entry.centralOffset + prefix.byteLength + 42)
  }
  mutated.writeUInt32LE(layout.centralOffset + prefix.byteLength, layout.eocdOffset + prefix.byteLength + 16)
  return mutated
}

function mutateFirstLocalHeader(archive: Buffer, mutate: (copy: Buffer, localOffset: number) => void): Buffer {
  const layout = parseProductionZipLayout(archive)
  const first = layout.entries[0]
  if (first === undefined) throw new Error('Expected a production local entry')
  const copy = Buffer.from(archive)
  mutate(copy, first.localOffset)
  return copy
}

function firstDescriptorOffset(archive: Buffer): number {
  const layout = parseProductionZipLayout(archive)
  const second = layout.entries[1]
  if (second === undefined) throw new Error('Expected two production local entries')
  const descriptorOffset = second.localOffset - 16
  if (archive.readUInt32LE(descriptorOffset) !== ZIP_DATA_DESCRIPTOR_SIGNATURE) {
    throw new Error('Expected the signed production data descriptor')
  }
  return descriptorOffset
}

async function mutateProductionZip(
  entries: ReadonlyArray<readonly [string, Buffer]>,
  mutate: (archive: Buffer) => Buffer
): Promise<Buffer> {
  return mutate(await customZip(entries))
}

let testDir = ''

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-bundle-integration-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

type ArchiveMutation = (archive: Buffer) => Buffer

async function expectInjectedArchiveRejected(
  label: string,
  createArchiveBuffer: (entries: ReadonlyArray<readonly [string, Buffer]>) => Promise<Buffer>
): Promise<void> {
  const destination = path.join(testDir, `malicious-${label.replaceAll(/[^a-z0-9]+/gi, '-')}.zip`)
  const builder = new MigrationDiagnosticBundleBuilder({
    createArchiveBuffer: async (entries) =>
      createArchiveBuffer(entries.map((entry) => [entry.name, entry.buffer] as const))
  })

  const result = await builder.save({
    destination,
    snapshot: snapshotWithCanaries(['attempt']),
    collectDatabaseDiagnostics: async () => databaseUnavailable()
  })

  expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
  expect(existsSync(destination)).toBe(false)
  expect(existsSync(`${destination}.partial`)).toBe(false)
}

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

  it('rejects five physical entries when a fixed central-directory name is duplicated', async () => {
    await expectInjectedArchiveRejected('duplicate-name', async (entries) => {
      const readme = entries.find(([name]) => name === 'README.txt')
      if (readme === undefined) throw new Error('Expected README entry')
      return customZip([...entries, readme])
    })
  })

  it.each<readonly [string, ArchiveMutation]>([
    ['bytes before the first local record', (archive) => Buffer.concat([Buffer.from('SFX!'), archive])],
    ['an adjusted SFX-style prefix before the first local record', addAdjustedPrefix],
    ['bytes after the final EOCD', (archive) => Buffer.concat([archive, Buffer.from('suffix')])],
    [
      'a gap between local records',
      (archive) => {
        const second = parseProductionZipLayout(archive).entries[1]
        if (second === undefined) throw new Error('Expected a second local record')
        return insertBeforeCentral(archive, second.localOffset, Buffer.from([0]), second.localOffset)
      }
    ],
    [
      'a gap between the final descriptor and central directory',
      (archive) => {
        const centralOffset = parseProductionZipLayout(archive).centralOffset
        return insertBeforeCentral(archive, centralOffset, Buffer.from([0]), Number.MAX_SAFE_INTEGER)
      }
    ],
    ['an unnecessary ZIP64 EOCD and locator', addUnnecessaryZip64Region]
  ])('rejects a non-canonical physical envelope containing %s', async (label, mutate) => {
    await expectInjectedArchiveRejected(label, (entries) => mutateProductionZip(entries, mutate))
  })

  it.each<readonly [string, ArchiveMutation]>([
    [
      'a local filename that disagrees with its central entry',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy[offset + 30] = 'x'.charCodeAt(0)
        })
    ],
    [
      'local flags that disagree with central flags',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy.writeUInt16LE(copy.readUInt16LE(offset + 6) | 0x0800, offset + 6)
        })
    ],
    [
      'a local method that disagrees with the central method',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy.writeUInt16LE(0, offset + 8)
        })
    ],
    [
      'a nonzero local CRC in descriptor mode',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy.writeUInt32LE(1, offset + 14)
        })
    ],
    [
      'a nonzero local compressed size in descriptor mode',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy.writeUInt32LE(1, offset + 18)
        })
    ],
    [
      'a nonzero local uncompressed size in descriptor mode',
      (archive) =>
        mutateFirstLocalHeader(archive, (copy, offset) => {
          copy.writeUInt32LE(1, offset + 22)
        })
    ],
    [
      'a descriptor CRC that disagrees with central CRC',
      (archive) => {
        const copy = Buffer.from(archive)
        const offset = firstDescriptorOffset(copy)
        copy.writeUInt32LE(copy.readUInt32LE(offset + 4) ^ 1, offset + 4)
        return copy
      }
    ],
    [
      'matching central and descriptor CRCs that disagree with the unchanged payload',
      (archive) => {
        const copy = Buffer.from(archive)
        const first = parseProductionZipLayout(copy).entries[0]
        if (first === undefined) throw new Error('Expected first central entry')
        const descriptorOffset = firstDescriptorOffset(copy)
        const changedCrc = (copy.readUInt32LE(first.centralOffset + 16) ^ 1) >>> 0
        copy.writeUInt32LE(changedCrc, first.centralOffset + 16)
        copy.writeUInt32LE(changedCrc, descriptorOffset + 4)
        return copy
      }
    ],
    [
      'a descriptor compressed size that disagrees with central size',
      (archive) => {
        const copy = Buffer.from(archive)
        const offset = firstDescriptorOffset(copy)
        copy.writeUInt32LE(copy.readUInt32LE(offset + 8) + 1, offset + 8)
        return copy
      }
    ],
    [
      'a descriptor uncompressed size that disagrees with central size',
      (archive) => {
        const copy = Buffer.from(archive)
        const offset = firstDescriptorOffset(copy)
        copy.writeUInt32LE(copy.readUInt32LE(offset + 12) + 1, offset + 12)
        return copy
      }
    ],
    [
      'an unsigned descriptor variant not emitted by production',
      (archive) => removeBeforeCentral(archive, firstDescriptorOffset(archive), 4)
    ]
  ])('rejects local/central metadata disagreement from %s', async (label, mutate) => {
    await expectInjectedArchiveRejected(label, (entries) => mutateProductionZip(entries, mutate))
  })

  it.each<readonly [string, ArchiveMutation]>([
    ['a local extra field', addLocalExtra],
    ['a central extra field', (archive) => addCentralMetadata(archive, 'extra')],
    ['a central entry comment', (archive) => addCentralMetadata(archive, 'comment')]
  ])('rejects non-canonical entry metadata containing %s', async (label, mutate) => {
    await expectInjectedArchiveRejected(label, (entries) => mutateProductionZip(entries, mutate))
  })

  it.each<readonly [string, ArchiveMutation]>([
    [
      'a central directory offset outside the buffer',
      (archive) => {
        const copy = Buffer.from(archive)
        const layout = parseProductionZipLayout(copy)
        copy.writeUInt32LE(0xfffffff0, layout.eocdOffset + 16)
        return copy
      }
    ],
    [
      'a truncated central directory size',
      (archive) => {
        const copy = Buffer.from(archive)
        const layout = parseProductionZipLayout(copy)
        copy.writeUInt32LE(layout.centralSize - 1, layout.eocdOffset + 12)
        return copy
      }
    ],
    [
      'a local record offset outside the buffer',
      (archive) => {
        const copy = Buffer.from(archive)
        const first = parseProductionZipLayout(copy).entries[0]
        if (first === undefined) throw new Error('Expected first central entry')
        copy.writeUInt32LE(0xfffffff0, first.centralOffset + 42)
        return copy
      }
    ],
    ['a truncated EOCD', (archive) => archive.subarray(0, archive.byteLength - 1)]
  ])('rejects malformed or truncated ZIP offsets from %s', async (label, mutate) => {
    await expectInjectedArchiveRejected(label, (entries) => mutateProductionZip(entries, mutate))
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
