import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { crc32 } from 'node:zlib'

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
const ZIP_PRODUCTION_VERSION_NEEDED = 20
const ZIP_PRODUCTION_FLAGS = 0x0008
const ZIP_PRODUCTION_METHOD = 8

export interface MigrationDiagnosticArchiveEntry {
  readonly name: MigrationDiagnosticStrictEntryName
  readonly buffer: Buffer
}

type CreateArchiveBuffer = (entries: readonly MigrationDiagnosticArchiveEntry[]) => Promise<Buffer>

export interface MigrationDiagnosticBundleBuilderOptions {
  readonly createArchiveBuffer?: CreateArchiveBuffer
  readonly platform?: NodeJS.Platform
}

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
  readonly crc: number
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly localOffset: number
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
    ...(event.payloadProfile === undefined ? {} : { payloadProfile: event.payloadProfile })
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
  return migrationDatabaseDiagnosticsDocumentSchema.parse({
    ...document,
    levels: {
      ...document.levels,
      [level]: { ...step, details: { status: 'omitted_for_size' } }
    }
  })
}

export function omitNextMigrationDatabaseDiagnosticDetails(
  document: MigrationDatabaseDiagnosticsDocument
): MigrationDatabaseDiagnosticsDocument | null {
  const validated = migrationDatabaseDiagnosticsDocumentSchema.parse(document)
  for (const level of DATABASE_DETAIL_OMISSION_ORDER) {
    const omitted = omitLevelDetails(validated, level)
    if (omitted !== null) return omitted
  }
  return null
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

function serializeStructured(schema: { parse(value: unknown): unknown }, value: unknown): Buffer {
  return Buffer.from(JSON.stringify(schema.parse(value)), 'utf8')
}

function serializeBundle(documents: SelectedDocuments): SerializedBundle {
  const events = serializeStructured(migrationDiagnosticEventsDocumentSchema, documents.events)
  const database = serializeStructured(migrationDatabaseDiagnosticsDocumentSchema, documents.database)
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
        manifest = migrationDiagnosticManifestSchema.parse(candidate)
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

function dropOldestIntermediateEvent(
  document: MigrationDiagnosticEventsDocument
): MigrationDiagnosticEventsDocument | null {
  let selectedAttemptIndex = -1
  let selectedEventIndex = -1
  let selectedSequence = Number.POSITIVE_INFINITY

  for (const [attemptIndex, attempt] of document.attempts.entries()) {
    const terminalIndex = attempt.outcome === 'in_progress' ? -1 : attempt.events.length - 1
    for (const [eventIndex, event] of attempt.events.entries()) {
      if (eventIndex === terminalIndex) continue
      if (event.sequence < selectedSequence) {
        selectedAttemptIndex = attemptIndex
        selectedEventIndex = eventIndex
        selectedSequence = event.sequence
      }
    }
  }
  if (selectedAttemptIndex === -1 || selectedEventIndex === -1) return null

  return migrationDiagnosticEventsDocumentSchema.parse({
    ...document,
    attempts: document.attempts.map((attempt, attemptIndex) =>
      attemptIndex === selectedAttemptIndex
        ? { ...attempt, events: attempt.events.filter((_event, eventIndex) => eventIndex !== selectedEventIndex) }
        : attempt
    )
  })
}

function selectDocumentsWithinBudget(
  events: MigrationDiagnosticEventsDocument,
  database: MigrationDatabaseDiagnosticsDocument
): SerializedBundle | null {
  let documents: SelectedDocuments = { events, database, droppedIntermediateEvents: 0 }
  for (;;) {
    const serialized = serializeBundle(documents)
    if (serialized.uncompressedBytes <= MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES) {
      if (serialized.manifest === null) throw new Error('manifest_validation_failed')
      assertStrictMigrationDiagnosticUncompressedBudget(serialized.entries.map((entry) => entry.buffer))
      return serialized
    }

    const trimmedEvents = dropOldestIntermediateEvent(documents.events)
    if (trimmedEvents !== null) {
      documents = {
        ...documents,
        events: trimmedEvents,
        droppedIntermediateEvents: documents.droppedIntermediateEvents + 1
      }
      continue
    }

    const trimmedDatabase = omitNextMigrationDatabaseDiagnosticDetails(documents.database)
    if (trimmedDatabase !== null) {
      documents = { ...documents, database: trimmedDatabase }
      continue
    }
    return null
  }
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

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function unlinkOwnedPartial(file: string): void {
  try {
    fs.unlinkSync(file)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
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

function validateCanonicalZipStructure(
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
        archive.readUInt16LE(centralCursor + 6) !== ZIP_PRODUCTION_VERSION_NEEDED ||
        archive.readUInt16LE(centralCursor + 8) !== ZIP_PRODUCTION_FLAGS ||
        archive.readUInt16LE(centralCursor + 10) !== ZIP_PRODUCTION_METHOD ||
        archive.readUInt16LE(centralCursor + 30) !== 0 ||
        archive.readUInt16LE(centralCursor + 32) !== 0 ||
        archive.readUInt16LE(centralCursor + 34) !== 0
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
        crc: centralCrc,
        compressedBytes,
        uncompressedBytes,
        localOffset
      })
      centralCursor += ZIP_CENTRAL_FILE_HEADER_BYTES + nameBytes
    }
    if (centralCursor !== centralOffset + centralBytes) return false

    let localCursor = 0
    for (const central of centralEntries) {
      if (
        central.localOffset !== localCursor ||
        !containsRange(archive, localCursor, ZIP_LOCAL_FILE_HEADER_BYTES) ||
        archive.readUInt32LE(localCursor) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE ||
        archive.readUInt16LE(localCursor + 4) !== ZIP_PRODUCTION_VERSION_NEEDED ||
        archive.readUInt16LE(localCursor + 6) !== central.flags ||
        archive.readUInt16LE(localCursor + 8) !== central.method ||
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

      const descriptorOffset = localNameOffset + localNameBytes + central.compressedBytes
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

function isRegularZipEntry(metadata: StreamZip.ZipEntry): boolean {
  if (!metadata.isFile || metadata.isDirectory) return false
  const unixFileType = (metadata.attr >>> 16) & ZIP_UNIX_FILE_TYPE_MASK
  return unixFileType === 0 || unixFileType === ZIP_UNIX_REGULAR_FILE
}

async function validateArchive(
  archiveFile: string,
  expectedEntries: readonly MigrationDiagnosticArchiveEntry[]
): Promise<boolean> {
  let zip: InstanceType<typeof StreamZip.async> | undefined
  try {
    if (!validateCanonicalZipStructure(fs.readFileSync(archiveFile), expectedEntries)) return false
    zip = new StreamZip.async({ file: archiveFile })
    const actualEntries = await zip.entries()
    const archiveComment: string | null = await zip.comment
    if (archiveComment !== null && archiveComment !== '') return false
    const names = Object.keys(actualEntries)
    if (
      names.length !== expectedEntries.length ||
      names.some((name, index) => name !== expectedEntries[index]?.name) ||
      names.some((name) => name.includes('/') || name.includes('\\'))
    ) {
      return false
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
        return false
      }
      const data = await zip.entryData(expected.name)
      if (!data.equals(expected.buffer)) return false
      extracted.push(data)
    }
    assertStrictMigrationDiagnosticUncompressedBudget(extracted)
    return true
  } catch {
    return false
  } finally {
    await zip?.close().catch(() => undefined)
  }
}

function closeBestEffort(fd: number | undefined): void {
  if (fd === undefined) return
  try {
    fs.closeSync(fd)
  } catch {
    // Preserve the first fixed publication failure.
  }
}

async function publishArchive(
  destination: string,
  archiveBuffer: Buffer,
  entries: readonly MigrationDiagnosticArchiveEntry[],
  platform: NodeJS.Platform
): Promise<PublicationFailure | null> {
  const partial = `${destination}.partial`
  let fd: number | undefined
  let ownsPartial = false
  let publication: 'not_published' | 'published' = 'not_published'
  try {
    fd = fs.openSync(partial, 'wx', 0o600)
    ownsPartial = true
    let offset = 0
    while (offset < archiveBuffer.byteLength) {
      const written = fs.writeSync(fd, archiveBuffer, offset, archiveBuffer.byteLength - offset)
      if (written <= 0) throw new Error('archive_short_write')
      offset += written
    }
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined

    if (!(await validateArchive(partial, entries))) {
      unlinkOwnedPartial(partial)
      ownsPartial = false
      return { kind: 'archive', publication: 'not_published' }
    }

    fs.renameSync(partial, destination)
    ownsPartial = false
    publication = 'published'
    if (platform !== 'win32') {
      const directoryFd = fs.openSync(path.dirname(destination), 'r')
      try {
        fs.fsyncSync(directoryFd)
      } finally {
        fs.closeSync(directoryFd)
      }
    }
    return null
  } catch {
    closeBestEffort(fd)
    if (ownsPartial) {
      try {
        unlinkOwnedPartial(partial)
      } catch {
        // Do not replace the stable publication result with cleanup details.
      }
    }
    return { kind: 'publish', publication }
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
  private readonly createArchiveBuffer: CreateArchiveBuffer
  private readonly platform: NodeJS.Platform

  constructor(options: MigrationDiagnosticBundleBuilderOptions = {}) {
    this.createArchiveBuffer = options.createArchiveBuffer ?? defaultCreateArchiveBuffer
    this.platform = options.platform ?? process.platform
  }

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
    try {
      archiveBuffer = await this.createArchiveBuffer(serialized.entries)
      if (!Buffer.isBuffer(archiveBuffer)) return failed('archive_failed')
    } catch {
      return failed('archive_failed')
    }

    const publicationFailure = await publishArchive(input.destination, archiveBuffer, serialized.entries, this.platform)
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
