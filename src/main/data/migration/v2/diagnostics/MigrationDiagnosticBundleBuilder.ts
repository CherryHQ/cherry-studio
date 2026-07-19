import { close as closeFileDescriptor, open as openFileDescriptor, type Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { crc32, inflateRawSync } from 'node:zlib'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'

import {
  MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
  MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION,
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema
} from './migrationDatabaseDiagnosticsSchemas'
import {
  MIGRATION_DIAGNOSTIC_STRICT_ENTRIES,
  MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES,
  type MigrationDatabaseDiagnosticDocumentLevel,
  type MigrationDatabaseDiagnosticsDocument,
  migrationDatabaseDiagnosticsDocumentSchema,
  type MigrationDiagnosticEventsDocument,
  migrationDiagnosticEventsDocumentSchema,
  type MigrationDiagnosticManifest,
  migrationDiagnosticManifestSchema,
  type MigrationDiagnosticStrictEntryName
} from './migrationDiagnosticBundleSchemas'
import type { MigrationDiagnosticsSnapshot } from './MigrationDiagnosticsCoordinator'
import {
  MIGRATION_DIAGNOSTIC_MIGRATOR_IDS,
  type MigrationDiagnosticEvent,
  type MigrationDiagnosticsSession,
  migrationDiagnosticsSessionSchema
} from './migrationDiagnosticsSchemas'

export { MIGRATION_DIAGNOSTIC_STRICT_ENTRIES, MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES }

const STRICT_README = `Cherry Studio migration diagnostics / Cherry Studio 迁移诊断

This archive contains only bounded structured migration events and read-only database diagnostics.
此压缩包仅包含有界的结构化迁移事件和只读数据库诊断。

It excludes application logs, database files and sidecars, journal files, exported business data, raw errors, stacks, SQL, credentials, paths, and user content.
它不包含应用日志、数据库及边车文件、journal、导出业务数据、原始错误、堆栈、SQL、凭据、路径或用户内容。

Please send this ZIP to the Cherry Studio developers when requesting migration support.
请在请求迁移支持时将此 ZIP 发送给 Cherry Studio 开发者。
`

const SAFE_MIGRATOR_IDS = new Set<string>(MIGRATION_DIAGNOSTIC_MIGRATOR_IDS)
const DATABASE_DETAIL_OMISSION_ORDER = ['l2', 'l1', 'l0'] as const
const MAX_MANIFEST_FIXED_POINT_ITERATIONS = 16
const ZIP_UNIX_FILE_TYPE_MASK = 0o170000
const ZIP_UNIX_REGULAR_FILE = 0o100000
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_LOCAL_FILE_HEADER_BYTES = 30
const ZIP_DATA_DESCRIPTOR_BYTES = 16
const ZIP_CENTRAL_FILE_HEADER_BYTES = 46
const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22
const ZIP_PRODUCTION_VERSION_MADE_BY = 0x032d
const ZIP_PRODUCTION_VERSION_NEEDED = 20
const ZIP_PRODUCTION_FLAGS = 0x0008
const ZIP_PRODUCTION_METHOD = 8
const ZIP_PRODUCTION_INTERNAL_ATTRIBUTES = 0
const ZIP_PRODUCTION_EXTERNAL_ATTRIBUTES = 0x81a40020
const MAX_FILE_CLOSE_ATTEMPTS = 2

export interface MigrationDiagnosticArchiveEntry {
  readonly name: MigrationDiagnosticStrictEntryName
  readonly buffer: Buffer
}

type CreateArchiveBuffer = (entries: readonly MigrationDiagnosticArchiveEntry[]) => Promise<Buffer>

export interface MigrationDiagnosticBundleSaveInput {
  readonly destination: string
  readonly snapshot: MigrationDiagnosticsSnapshot | MigrationDiagnosticsSession
  readonly collectDatabaseDiagnostics: () => Promise<MigrationDatabaseDiagnosticResult>
}

export type MigrationDiagnosticBundleSaveResult =
  | {
      readonly status: 'saved'
      readonly publication: 'published'
      readonly uncompressedBytes: number
    }
  | {
      readonly status: 'failed'
      readonly code: 'invalid_input' | 'budget_exceeded' | 'archive_failed' | 'publish_failed'
      readonly publication: 'not_published' | 'published'
    }

interface SelectedDocuments {
  events: MigrationDiagnosticEventsDocument
  database: MigrationDatabaseDiagnosticsDocument
  droppedIntermediateEvents: number
}

interface SerializedBundle {
  readonly entries: readonly MigrationDiagnosticArchiveEntry[]
  readonly manifest: MigrationDiagnosticManifest | null
  readonly uncompressedBytes: number
}

interface PublicationFailure {
  readonly kind: 'archive' | 'publish'
  readonly publication: 'not_published' | 'published'
}

interface CanonicalZipCentralEntry {
  readonly name: Buffer
  readonly flags: number
  readonly method: number
  readonly modifiedTime: number
  readonly crc: number
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly localOffset: number
}

interface InflateRawInfo {
  readonly buffer: Buffer
  readonly engine: { readonly bytesWritten: number }
}

function failed(
  code: Extract<MigrationDiagnosticBundleSaveResult, { status: 'failed' }>['code'],
  publication: 'not_published' | 'published' = 'not_published'
): MigrationDiagnosticBundleSaveResult {
  return Object.freeze({ status: 'failed', code, publication })
}

function normalizeAppVersion(value: string): string {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:$|[-+])/.exec(value)
  return match === null ? 'unknown' : `${match[1]}.${match[2]}.${match[3]}`
}

function normalizeMigratorId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return SAFE_MIGRATOR_IDS.has(value) ? value : 'unknown'
}

function createBundleEvent(event: MigrationDiagnosticEvent) {
  return {
    sequence: event.sequence,
    at: event.at,
    scope: event.scope,
    phase: event.phase,
    state: event.state,
    code: event.code,
    ...(event.category === undefined ? {} : { category: event.category }),
    ...(event.causeDepth === undefined ? {} : { causeDepth: event.causeDepth }),
    ...(event.migratorId === undefined ? {} : { migratorId: normalizeMigratorId(event.migratorId) }),
    ...(event.payloadProfile === undefined ? {} : { payloadProfile: event.payloadProfile }),
    ...(event.versionGate === undefined ? {} : { versionGate: event.versionGate })
  }
}

function createMigrationDiagnosticEventsDocument(
  snapshot: MigrationDiagnosticsSession
): MigrationDiagnosticEventsDocument {
  return migrationDiagnosticEventsDocumentSchema.parse({
    formatVersion: 1,
    session: {
      appVersion: normalizeAppVersion(snapshot.appVersion),
      platform: snapshot.platform,
      arch: snapshot.arch,
      startedAt: snapshot.startedAt,
      state: snapshot.state
    },
    attempts: snapshot.attempts.map((attempt, attemptIndex) => ({
      id: `attempt-${attemptIndex + 1}`,
      trigger: attempt.trigger,
      startedAt: attempt.startedAt,
      outcome: attempt.outcome,
      ...(attempt.outcome === 'in_progress' ? {} : { endedAt: attempt.endedAt }),
      events: attempt.events.map(createBundleEvent)
    }))
  })
}

function transformDatabaseStep(step: NonNullable<MigrationDatabaseDiagnosticResult['l0' | 'l1' | 'l2']>) {
  const { data, ...status } = step
  return {
    ...status,
    details: data === undefined ? { status: 'unavailable' as const } : { status: 'included' as const, data }
  }
}

export function createMigrationDatabaseDiagnosticsDocument(
  diagnostics: MigrationDatabaseDiagnosticResult
): MigrationDatabaseDiagnosticsDocument {
  const validated = migrationDatabaseDiagnosticResultSchema.parse(diagnostics)
  return migrationDatabaseDiagnosticsDocumentSchema.parse({
    formatVersion: 1,
    diagnosticVersion: validated.version,
    expectedSchemaVersion: validated.expectedSchemaVersion,
    completion: validated.completion,
    levels: {
      ...('l0' in validated && validated.l0 !== undefined ? { l0: transformDatabaseStep(validated.l0) } : {}),
      ...('l1' in validated && validated.l1 !== undefined ? { l1: transformDatabaseStep(validated.l1) } : {}),
      ...('l2' in validated && validated.l2 !== undefined ? { l2: transformDatabaseStep(validated.l2) } : {})
    }
  })
}

function unavailableDatabaseDiagnostics(): MigrationDatabaseDiagnosticResult {
  return migrationDatabaseDiagnosticResultSchema.parse({
    version: MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
    expectedSchemaVersion: MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION,
    completion: { status: 'failed', code: 'process_error' }
  })
}

async function collectSafeDatabaseDiagnostics(
  collector: () => Promise<MigrationDatabaseDiagnosticResult>
): Promise<MigrationDatabaseDiagnosticResult> {
  try {
    const result = await collector()
    const parsed = migrationDatabaseDiagnosticResultSchema.safeParse(result)
    return parsed.success ? parsed.data : unavailableDatabaseDiagnostics()
  } catch {
    return unavailableDatabaseDiagnostics()
  }
}

function omitLevelDetails(
  document: MigrationDatabaseDiagnosticsDocument,
  level: MigrationDatabaseDiagnosticDocumentLevel
): MigrationDatabaseDiagnosticsDocument | null {
  const step = document.levels[level]
  if (step === undefined || step.details.status !== 'included') return null
  return {
    ...document,
    levels: {
      ...document.levels,
      [level]: { ...step, details: { status: 'omitted_for_size' } }
    }
  } as MigrationDatabaseDiagnosticsDocument
}

function omitNextMigrationDatabaseDiagnosticDetailsUnchecked(
  document: MigrationDatabaseDiagnosticsDocument
): MigrationDatabaseDiagnosticsDocument | null {
  for (const level of DATABASE_DETAIL_OMISSION_ORDER) {
    const omitted = omitLevelDetails(document, level)
    if (omitted !== null) return omitted
  }
  return null
}

export function omitNextMigrationDatabaseDiagnosticDetails(
  document: MigrationDatabaseDiagnosticsDocument
): MigrationDatabaseDiagnosticsDocument | null {
  return omitNextMigrationDatabaseDiagnosticDetailsUnchecked(migrationDatabaseDiagnosticsDocumentSchema.parse(document))
}

function omittedDatabaseDetails(document: MigrationDatabaseDiagnosticsDocument): Array<'l2' | 'l1' | 'l0'> {
  return DATABASE_DETAIL_OMISSION_ORDER.filter((level) => document.levels[level]?.details.status === 'omitted_for_size')
}

function databaseComponentStatus(
  document: MigrationDatabaseDiagnosticsDocument
): 'complete' | 'partial' | 'unavailable' {
  if (document.completion.status === 'completed') return 'complete'
  return Object.keys(document.levels).length === 0 ? 'unavailable' : 'partial'
}

function createManifestCandidate(
  documents: SelectedDocuments,
  byteLengths: Readonly<Record<MigrationDiagnosticStrictEntryName, number>>
) {
  const omissions = omittedDatabaseDetails(documents.database)
  return {
    formatVersion: 1 as const,
    policy: 'strict' as const,
    session: {
      ...documents.events.session,
      attempts: documents.events.attempts.map((attempt) => ({
        id: attempt.id,
        trigger: attempt.trigger,
        startedAt: attempt.startedAt,
        outcome: attempt.outcome,
        ...(attempt.outcome === 'in_progress' ? {} : { endedAt: attempt.endedAt })
      }))
    },
    components: {
      migrationEvents: {
        status: documents.droppedIntermediateEvents === 0 ? ('complete' as const) : ('truncated' as const)
      },
      databaseDiagnostics: {
        status: databaseComponentStatus(documents.database),
        details: omissions.length === 0 ? ('complete' as const) : ('truncated' as const)
      }
    },
    truncation: {
      droppedIntermediateEvents: documents.droppedIntermediateEvents,
      omittedDatabaseDetails: omissions
    },
    entries: MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.map((name) => ({
      name,
      uncompressedBytes: byteLengths[name]
    })),
    totalUncompressedBytes: MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.reduce((total, name) => total + byteLengths[name], 0)
  }
}

function serializeStructured(schema: { parse(value: unknown): unknown }, value: unknown, strict: boolean): Buffer {
  return Buffer.from(JSON.stringify(strict ? schema.parse(value) : value), 'utf8')
}

function serializeBundle(documents: SelectedDocuments, strict: boolean): SerializedBundle {
  const events = serializeStructured(migrationDiagnosticEventsDocumentSchema, documents.events, strict)
  const database = serializeStructured(migrationDatabaseDiagnosticsDocumentSchema, documents.database, strict)
  const readme = Buffer.from(STRICT_README, 'utf8')
  const byteLengths: Record<MigrationDiagnosticStrictEntryName, number> = {
    'manifest.json': 0,
    'migration-events.json': events.byteLength,
    'database-diagnostics.json': database.byteLength,
    'README.txt': readme.byteLength
  }

  let manifestBuffer = Buffer.alloc(0)
  let manifest: MigrationDiagnosticManifest | null = null
  for (let iteration = 0; iteration < MAX_MANIFEST_FIXED_POINT_ITERATIONS; iteration += 1) {
    const candidate = createManifestCandidate(documents, byteLengths)
    manifestBuffer = Buffer.from(JSON.stringify(candidate), 'utf8')
    const total = events.byteLength + database.byteLength + readme.byteLength + manifestBuffer.byteLength
    if (byteLengths['manifest.json'] === manifestBuffer.byteLength && candidate.totalUncompressedBytes === total) {
      if (total <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
        manifest = strict
          ? migrationDiagnosticManifestSchema.parse(candidate)
          : (candidate as MigrationDiagnosticManifest)
        manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8')
        if (
          manifest.entries[0]?.uncompressedBytes !== manifestBuffer.byteLength ||
          manifest.totalUncompressedBytes !== total
        ) {
          throw new Error('manifest_fixed_point_failed')
        }
      }
      return {
        entries: [
          { name: 'manifest.json', buffer: manifestBuffer },
          { name: 'migration-events.json', buffer: events },
          { name: 'database-diagnostics.json', buffer: database },
          { name: 'README.txt', buffer: readme }
        ],
        manifest,
        uncompressedBytes: total
      }
    }
    byteLengths['manifest.json'] = manifestBuffer.byteLength
  }
  throw new Error('manifest_fixed_point_failed')
}

interface IntermediateEventLocation {
  readonly attemptIndex: number
  readonly eventIndex: number
  readonly sequence: number
}

function intermediateEventsInDropOrder(
  document: MigrationDiagnosticEventsDocument
): readonly IntermediateEventLocation[] {
  const locations: IntermediateEventLocation[] = []
  for (const [attemptIndex, attempt] of document.attempts.entries()) {
    const terminalIndex = attempt.outcome === 'in_progress' ? -1 : attempt.events.length - 1
    for (const [eventIndex, event] of attempt.events.entries()) {
      if (eventIndex === terminalIndex) continue
      locations.push({ attemptIndex, eventIndex, sequence: event.sequence })
    }
  }
  return locations.sort((left, right) => left.sequence - right.sequence)
}

function dropOldestIntermediateEvents(
  document: MigrationDiagnosticEventsDocument,
  locations: readonly IntermediateEventLocation[],
  count: number
): MigrationDiagnosticEventsDocument {
  const removed = new Set(
    locations.slice(0, count).map(({ attemptIndex, eventIndex }) => `${attemptIndex}:${eventIndex}`)
  )
  return {
    ...document,
    attempts: document.attempts.map((attempt, attemptIndex) => ({
      ...attempt,
      events: attempt.events.filter((_event, eventIndex) => !removed.has(`${attemptIndex}:${eventIndex}`))
    }))
  }
}

function finalizeSelectedDocuments(documents: SelectedDocuments): SerializedBundle {
  const serialized = serializeBundle(documents, true)
  if (serialized.manifest === null || serialized.uncompressedBytes > MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
    throw new Error('manifest_validation_failed')
  }
  assertStrictMigrationDiagnosticUncompressedBudget(serialized.entries.map((entry) => entry.buffer))
  return serialized
}

function selectDocumentsWithinBudget(
  events: MigrationDiagnosticEventsDocument,
  database: MigrationDatabaseDiagnosticsDocument
): SerializedBundle | null {
  let documents: SelectedDocuments = { events, database, droppedIntermediateEvents: 0 }
  if (serializeBundle(documents, false).uncompressedBytes <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
    return finalizeSelectedDocuments(documents)
  }

  const intermediateEvents = intermediateEventsInDropOrder(events)
  if (intermediateEvents.length > 0) {
    const allEventsDropped: SelectedDocuments = {
      events: dropOldestIntermediateEvents(events, intermediateEvents, intermediateEvents.length),
      database,
      droppedIntermediateEvents: intermediateEvents.length
    }
    if (serializeBundle(allEventsDropped, false).uncompressedBytes <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
      let lowerBound = 1
      let upperBound = intermediateEvents.length
      while (lowerBound < upperBound) {
        const candidateCount = Math.floor((lowerBound + upperBound) / 2)
        const candidate: SelectedDocuments = {
          events: dropOldestIntermediateEvents(events, intermediateEvents, candidateCount),
          database,
          droppedIntermediateEvents: candidateCount
        }
        if (serializeBundle(candidate, false).uncompressedBytes <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
          upperBound = candidateCount
        } else {
          lowerBound = candidateCount + 1
        }
      }
      return finalizeSelectedDocuments({
        events: dropOldestIntermediateEvents(events, intermediateEvents, lowerBound),
        database,
        droppedIntermediateEvents: lowerBound
      })
    }
    documents = allEventsDropped
  }

  for (let omissionCount = 0; omissionCount < DATABASE_DETAIL_OMISSION_ORDER.length; omissionCount += 1) {
    const trimmedDatabase = omitNextMigrationDatabaseDiagnosticDetailsUnchecked(documents.database)
    if (trimmedDatabase === null) return null
    documents = { ...documents, database: trimmedDatabase }
    if (serializeBundle(documents, false).uncompressedBytes <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
      return finalizeSelectedDocuments(documents)
    }
  }
  return null
}

export function assertStrictMigrationDiagnosticUncompressedBudget(buffers: readonly Buffer[]): number {
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  if (total > MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) throw new Error('budget_exceeded')
  return total
}

async function defaultCreateArchiveBuffer(entries: readonly MigrationDiagnosticArchiveEntry[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const output = new PassThrough()
    const chunks: Buffer[] = []
    const archive = new ZipArchive({ zlib: { level: 1 } })
    let settled = false

    const fail = (): void => {
      if (settled) return
      settled = true
      archive.abort()
      output.destroy()
      reject(new Error('archive_failed'))
    }
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    output.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    output.once('error', fail)
    archive.once('warning', fail)
    archive.once('error', fail)
    archive.pipe(output)
    for (const entry of entries) archive.append(entry.buffer, { name: entry.name })
    void archive.finalize().catch(fail)
  })
}

function containsRange(buffer: Buffer, offset: number, length: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= buffer.byteLength - length
  )
}

function copyArchiveEntries(
  entries: readonly MigrationDiagnosticArchiveEntry[]
): readonly MigrationDiagnosticArchiveEntry[] {
  return entries.map((entry) => Object.freeze({ name: entry.name, buffer: Buffer.from(entry.buffer) }))
}

/** @internal Exported only for same-module contract tests; not re-exported by the diagnostics barrel. */
export function validateCanonicalZipStructure(
  archive: Buffer,
  expectedEntries: readonly MigrationDiagnosticArchiveEntry[]
): boolean {
  try {
    if (
      expectedEntries.length !== MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.length ||
      archive.byteLength < ZIP_END_OF_CENTRAL_DIRECTORY_BYTES
    ) {
      return false
    }

    const eocdOffset = archive.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES
    if (
      archive.readUInt32LE(eocdOffset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE ||
      archive.readUInt16LE(eocdOffset + 4) !== 0 ||
      archive.readUInt16LE(eocdOffset + 6) !== 0 ||
      archive.readUInt16LE(eocdOffset + 8) !== expectedEntries.length ||
      archive.readUInt16LE(eocdOffset + 10) !== expectedEntries.length ||
      archive.readUInt16LE(eocdOffset + 20) !== 0
    ) {
      return false
    }

    const centralBytes = archive.readUInt32LE(eocdOffset + 12)
    const centralOffset = archive.readUInt32LE(eocdOffset + 16)
    if (
      centralOffset === 0xffffffff ||
      centralBytes === 0xffffffff ||
      !containsRange(archive, centralOffset, centralBytes) ||
      centralOffset + centralBytes !== eocdOffset
    ) {
      return false
    }

    const centralEntries: CanonicalZipCentralEntry[] = []
    let centralCursor = centralOffset
    for (const expected of expectedEntries) {
      if (
        !containsRange(archive, centralCursor, ZIP_CENTRAL_FILE_HEADER_BYTES) ||
        archive.readUInt32LE(centralCursor) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE ||
        archive.readUInt16LE(centralCursor + 4) !== ZIP_PRODUCTION_VERSION_MADE_BY ||
        archive.readUInt16LE(centralCursor + 6) !== ZIP_PRODUCTION_VERSION_NEEDED ||
        archive.readUInt16LE(centralCursor + 8) !== ZIP_PRODUCTION_FLAGS ||
        archive.readUInt16LE(centralCursor + 10) !== ZIP_PRODUCTION_METHOD ||
        archive.readUInt16LE(centralCursor + 30) !== 0 ||
        archive.readUInt16LE(centralCursor + 32) !== 0 ||
        archive.readUInt16LE(centralCursor + 34) !== 0 ||
        archive.readUInt16LE(centralCursor + 36) !== ZIP_PRODUCTION_INTERNAL_ATTRIBUTES ||
        archive.readUInt32LE(centralCursor + 38) !== ZIP_PRODUCTION_EXTERNAL_ATTRIBUTES
      ) {
        return false
      }

      const nameBytes = archive.readUInt16LE(centralCursor + 28)
      const expectedName = Buffer.from(expected.name, 'utf8')
      if (
        nameBytes !== expectedName.byteLength ||
        !containsRange(archive, centralCursor + ZIP_CENTRAL_FILE_HEADER_BYTES, nameBytes)
      ) {
        return false
      }
      const name = archive.subarray(
        centralCursor + ZIP_CENTRAL_FILE_HEADER_BYTES,
        centralCursor + ZIP_CENTRAL_FILE_HEADER_BYTES + nameBytes
      )
      if (!name.equals(expectedName)) return false

      const compressedBytes = archive.readUInt32LE(centralCursor + 20)
      const uncompressedBytes = archive.readUInt32LE(centralCursor + 24)
      const localOffset = archive.readUInt32LE(centralCursor + 42)
      const centralCrc = archive.readUInt32LE(centralCursor + 16)
      if (
        compressedBytes === 0xffffffff ||
        uncompressedBytes === 0xffffffff ||
        localOffset === 0xffffffff ||
        centralCrc !== crc32(expected.buffer) >>> 0 ||
        uncompressedBytes !== expected.buffer.byteLength
      ) {
        return false
      }
      centralEntries.push({
        name,
        flags: archive.readUInt16LE(centralCursor + 8),
        method: archive.readUInt16LE(centralCursor + 10),
        modifiedTime: archive.readUInt32LE(centralCursor + 12),
        crc: centralCrc,
        compressedBytes,
        uncompressedBytes,
        localOffset
      })
      centralCursor += ZIP_CENTRAL_FILE_HEADER_BYTES + nameBytes
    }
    if (centralCursor !== centralOffset + centralBytes) return false

    let localCursor = 0
    for (const [entryIndex, central] of centralEntries.entries()) {
      const expected = expectedEntries[entryIndex]
      if (expected === undefined) return false
      if (
        central.localOffset !== localCursor ||
        !containsRange(archive, localCursor, ZIP_LOCAL_FILE_HEADER_BYTES) ||
        archive.readUInt32LE(localCursor) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE ||
        archive.readUInt16LE(localCursor + 4) !== ZIP_PRODUCTION_VERSION_NEEDED ||
        archive.readUInt16LE(localCursor + 6) !== central.flags ||
        archive.readUInt16LE(localCursor + 8) !== central.method ||
        archive.readUInt32LE(localCursor + 10) !== central.modifiedTime ||
        archive.readUInt32LE(localCursor + 14) !== 0 ||
        archive.readUInt32LE(localCursor + 18) !== 0 ||
        archive.readUInt32LE(localCursor + 22) !== 0 ||
        archive.readUInt16LE(localCursor + 28) !== 0
      ) {
        return false
      }

      const localNameBytes = archive.readUInt16LE(localCursor + 26)
      const localNameOffset = localCursor + ZIP_LOCAL_FILE_HEADER_BYTES
      if (
        localNameBytes !== central.name.byteLength ||
        !containsRange(archive, localNameOffset, localNameBytes) ||
        !archive.subarray(localNameOffset, localNameOffset + localNameBytes).equals(central.name)
      ) {
        return false
      }

      const compressedOffset = localNameOffset + localNameBytes
      if (!containsRange(archive, compressedOffset, central.compressedBytes)) return false
      const inflated = inflateRawSync(archive.subarray(compressedOffset, compressedOffset + central.compressedBytes), {
        info: true,
        maxOutputLength: expected.buffer.byteLength
      }) as unknown as InflateRawInfo
      if (inflated.engine.bytesWritten !== central.compressedBytes || !inflated.buffer.equals(expected.buffer)) {
        return false
      }

      const descriptorOffset = compressedOffset + central.compressedBytes
      if (
        !containsRange(archive, descriptorOffset, ZIP_DATA_DESCRIPTOR_BYTES) ||
        archive.readUInt32LE(descriptorOffset) !== ZIP_DATA_DESCRIPTOR_SIGNATURE ||
        archive.readUInt32LE(descriptorOffset + 4) !== central.crc ||
        archive.readUInt32LE(descriptorOffset + 8) !== central.compressedBytes ||
        archive.readUInt32LE(descriptorOffset + 12) !== central.uncompressedBytes
      ) {
        return false
      }
      localCursor = descriptorOffset + ZIP_DATA_DESCRIPTOR_BYTES
    }
    return localCursor === centralOffset
  } catch {
    return false
  }
}

/** @internal Keeps the validation oracle private from the archive producer. */
export async function createCanonicalMigrationDiagnosticArchive(
  entries: readonly MigrationDiagnosticArchiveEntry[],
  createArchiveBuffer: CreateArchiveBuffer = defaultCreateArchiveBuffer
): Promise<Buffer> {
  const canonicalEntries = copyArchiveEntries(entries)
  try {
    const created = await createArchiveBuffer(copyArchiveEntries(canonicalEntries))
    if (!Buffer.isBuffer(created)) throw new Error('archive_failed')
    const archiveBuffer = Buffer.from(created)
    if (!validateCanonicalZipStructure(archiveBuffer, canonicalEntries)) throw new Error('archive_failed')
    return archiveBuffer
  } catch {
    throw new Error('archive_failed')
  }
}

function isRegularZipEntry(metadata: StreamZip.ZipEntry): boolean {
  if (!metadata.isFile || metadata.isDirectory) return false
  const unixFileType = (metadata.attr >>> 16) & ZIP_UNIX_FILE_TYPE_MASK
  return unixFileType === 0 || unixFileType === ZIP_UNIX_REGULAR_FILE
}

async function validateArchive(
  archiveFile: string,
  archiveBuffer: Buffer,
  expectedEntries: readonly MigrationDiagnosticArchiveEntry[]
): Promise<boolean> {
  let zip: InstanceType<typeof StreamZip.async> | undefined
  let ownedDescriptor: number | undefined
  let valid = false
  let streamZipClosed = false
  try {
    if (!validateCanonicalZipStructure(archiveBuffer, expectedEntries)) return false
    ownedDescriptor = await openOwnedValidationDescriptor(archiveFile)
    zip = new StreamZip.async({ fd: ownedDescriptor })
    const actualEntries = await zip.entries()
    const archiveComment: string | null = await zip.comment
    if (archiveComment !== null && archiveComment !== '') throw new Error('archive_invalid')
    const names = Object.keys(actualEntries)
    if (
      names.length !== expectedEntries.length ||
      names.some((name, index) => name !== expectedEntries[index]?.name) ||
      names.some((name) => name.includes('/') || name.includes('\\'))
    ) {
      throw new Error('archive_invalid')
    }

    const extracted: Buffer[] = []
    for (const expected of expectedEntries) {
      const metadata = actualEntries[expected.name]
      if (
        metadata === undefined ||
        !isRegularZipEntry(metadata) ||
        metadata.encrypted ||
        ((metadata.comment as string | null) !== null && metadata.comment !== '')
      ) {
        throw new Error('archive_invalid')
      }
      const data = await zip.entryData(expected.name)
      if (!data.equals(expected.buffer)) throw new Error('archive_invalid')
      extracted.push(data)
    }
    assertStrictMigrationDiagnosticUncompressedBudget(extracted)
    valid = true
  } catch {
    valid = false
  }
  try {
    if (zip !== undefined) {
      await zip.close()
      streamZipClosed = true
    }
  } catch {
    streamZipClosed = false
  }
  if (ownedDescriptor !== undefined && !streamZipClosed) {
    await closeOwnedValidationDescriptor(ownedDescriptor)
  }
  return valid && streamZipClosed
}

function openOwnedValidationDescriptor(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    openFileDescriptor(file, 'r', (error, descriptor) => {
      if (error !== null) reject(error)
      else resolve(descriptor)
    })
  })
}

function closeValidationDescriptorOnce(descriptor: number): Promise<boolean> {
  return new Promise((resolve) => {
    closeFileDescriptor(descriptor, (error) => resolve(error === null))
  })
}

async function closeOwnedValidationDescriptor(descriptor: number): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_FILE_CLOSE_ATTEMPTS; attempt += 1) {
    if (await closeValidationDescriptorOnce(descriptor)) return true
  }
  return false
}

interface FileIdentity {
  readonly dev: number
  readonly ino: number
}

interface TrackedFileHandle {
  readonly handle: FileHandle
  closeAttempts: number
  closeSucceeded: boolean
}

function trackFileHandle(handles: TrackedFileHandle[], handle: FileHandle): TrackedFileHandle {
  const tracked = { handle, closeAttempts: 0, closeSucceeded: false }
  handles.push(tracked)
  return tracked
}

async function closeTrackedFileHandle(tracked: TrackedFileHandle): Promise<boolean> {
  if (tracked.closeSucceeded) return true
  if (tracked.closeAttempts >= MAX_FILE_CLOSE_ATTEMPTS) return false
  tracked.closeAttempts += 1
  try {
    await tracked.handle.close()
    tracked.closeSucceeded = true
  } catch {
    return false
  }
  return true
}

async function closeRemainingFileHandles(handles: readonly TrackedFileHandle[]): Promise<boolean> {
  let allClosed = true
  for (const handle of handles) {
    while (!handle.closeSucceeded && handle.closeAttempts < MAX_FILE_CLOSE_ATTEMPTS) {
      await closeTrackedFileHandle(handle)
    }
    if (!handle.closeSucceeded) allClosed = false
  }
  return allClosed
}

function identityFromStats(stats: Stats): FileIdentity | null {
  return stats.isFile() ? { dev: stats.dev, ino: stats.ino } : null
}

function matchesIdentity(actual: { readonly dev: number; readonly ino: number }, expected: FileIdentity): boolean {
  return actual.dev === expected.dev && actual.ino === expected.ino
}

async function pathMatchesOwnedRegularFile(file: string, identity: FileIdentity): Promise<boolean> {
  try {
    const stats = await lstat(file)
    return stats.isFile() && matchesIdentity(stats, identity)
  } catch {
    return false
  }
}

async function unlinkOwnedPartial(file: string, identity: FileIdentity): Promise<void> {
  try {
    if (!(await pathMatchesOwnedRegularFile(file, identity))) return
    await unlink(file)
  } catch {
    // Cleanup is best effort; callers keep their fixed failure classification.
  }
}

async function publishArchive(
  destination: string,
  archiveBuffer: Buffer,
  entries: readonly MigrationDiagnosticArchiveEntry[],
  platform: NodeJS.Platform
): Promise<PublicationFailure | null> {
  const partial = `${destination}.partial`
  const handles: TrackedFileHandle[] = []
  let ownedIdentity: FileIdentity | null = null
  let publication: 'not_published' | 'published' = 'not_published'
  try {
    const writeHandle = trackFileHandle(handles, await open(partial, 'wx', 0o600))
    ownedIdentity = identityFromStats(await writeHandle.handle.stat())
    if (ownedIdentity === null) throw new Error('archive_partial_not_regular')
    let offset = 0
    while (offset < archiveBuffer.byteLength) {
      const { bytesWritten } = await writeHandle.handle.write(
        archiveBuffer,
        offset,
        archiveBuffer.byteLength - offset,
        offset
      )
      if (bytesWritten <= 0) throw new Error('archive_short_write')
      offset += bytesWritten
    }
    await writeHandle.handle.sync()
    if (!(await closeTrackedFileHandle(writeHandle))) throw new Error('archive_write_close_failed')

    const readHandle = trackFileHandle(handles, await open(partial, 'r'))
    const readIdentity = identityFromStats(await readHandle.handle.stat())
    if (readIdentity === null || !matchesIdentity(readIdentity, ownedIdentity)) {
      await closeTrackedFileHandle(readHandle)
      return { kind: 'publish', publication: 'not_published' }
    }
    const archiveOnDisk = await readHandle.handle.readFile()
    const pathOwnedBeforeValidation = await pathMatchesOwnedRegularFile(partial, ownedIdentity)
    const archiveValid = pathOwnedBeforeValidation && (await validateArchive(partial, archiveOnDisk, entries))
    const pathOwnedAfterValidation = await pathMatchesOwnedRegularFile(partial, ownedIdentity)
    const readClosed = await closeTrackedFileHandle(readHandle)
    if (!pathOwnedAfterValidation) return { kind: 'publish', publication: 'not_published' }
    if (!readClosed) {
      const handlesClosed = await closeRemainingFileHandles(handles)
      if (handlesClosed) await unlinkOwnedPartial(partial, ownedIdentity)
      return { kind: 'archive', publication: 'not_published' }
    }
    if (!archiveValid) {
      await unlinkOwnedPartial(partial, ownedIdentity)
      return { kind: 'archive', publication: 'not_published' }
    }

    if (!(await pathMatchesOwnedRegularFile(partial, ownedIdentity))) {
      return { kind: 'publish', publication: 'not_published' }
    }
    await rename(partial, destination)
    publication = 'published'
    if (platform !== 'win32') {
      const directoryHandle = trackFileHandle(handles, await open(path.dirname(destination), 'r'))
      await directoryHandle.handle.sync()
      if (!(await closeTrackedFileHandle(directoryHandle))) {
        return { kind: 'publish', publication: 'published' }
      }
    }
    return null
  } catch {
    const handlesClosed = await closeRemainingFileHandles(handles)
    if (publication === 'not_published' && ownedIdentity !== null && handlesClosed) {
      await unlinkOwnedPartial(partial, ownedIdentity)
    }
    return { kind: 'publish', publication }
  } finally {
    await closeRemainingFileHandles(handles)
  }
}

function validDestination(destination: string): boolean {
  if (destination.length === 0 || !path.isAbsolute(destination)) return false
  const basename = path.basename(destination)
  return (
    basename.length > 0 &&
    basename !== '.' &&
    basename !== '..' &&
    path.normalize(destination) !== path.parse(destination).root
  )
}

export class MigrationDiagnosticBundleBuilder {
  async save(input: MigrationDiagnosticBundleSaveInput): Promise<MigrationDiagnosticBundleSaveResult> {
    if (!validDestination(input.destination)) return failed('invalid_input')

    const snapshot = migrationDiagnosticsSessionSchema.safeParse(input.snapshot)
    if (!snapshot.success) return failed('invalid_input')

    let events: MigrationDiagnosticEventsDocument
    try {
      events = createMigrationDiagnosticEventsDocument(snapshot.data)
    } catch {
      return failed('invalid_input')
    }

    const database = createMigrationDatabaseDiagnosticsDocument(
      await collectSafeDatabaseDiagnostics(input.collectDatabaseDiagnostics)
    )
    let serialized: SerializedBundle | null
    try {
      serialized = selectDocumentsWithinBudget(events, database)
    } catch {
      return failed('invalid_input')
    }
    if (serialized === null) return failed('budget_exceeded')

    let archiveBuffer: Buffer
    const canonicalEntries = copyArchiveEntries(serialized.entries)
    try {
      archiveBuffer = await createCanonicalMigrationDiagnosticArchive(canonicalEntries)
    } catch {
      return failed('archive_failed')
    }

    const publicationFailure = await publishArchive(
      input.destination,
      archiveBuffer,
      canonicalEntries,
      process.platform
    )
    if (publicationFailure !== null) {
      return failed(
        publicationFailure.kind === 'archive' ? 'archive_failed' : 'publish_failed',
        publicationFailure.publication
      )
    }
    return Object.freeze({
      status: 'saved',
      publication: 'published',
      uncompressedBytes: serialized.uncompressedBytes
    })
  }
}
